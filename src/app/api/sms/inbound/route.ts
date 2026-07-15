/**
 * POST /api/sms/inbound — Twilio inbound-SMS webhook.
 *
 * Every org's provisioned number is configured with this route as its SmsUrl
 * (see lib/twilio-provision.ts). Until now the route didn't exist, so inbound
 * texts — including STOP — hit a 404. That left carrier opt-out compliance
 * resting entirely on Twilio's account-level Advanced Opt-Out toggle, and even
 * when that fired, our DB never learned about it: the app kept showing the
 * client as opted-in and would keep trying to text them.
 *
 * This handler:
 *   1. Verifies Twilio's request signature (HMAC-SHA1 over the URL + params).
 *   2. Resolves the org from the `To` number and the client from the `From`.
 *   3. Honors STOP / UNSUBSCRIBE / CANCEL … → flips clients.sms_opted_in false
 *      (the same flag every client send path gates on), and START/YES → true.
 *   4. Answers HELP with a support message.
 *   5. Replies with TwiML so the sender gets the mandatory opt-out/HELP
 *      confirmation.
 *
 * Security: no auth session (Twilio is the caller), but the signature check
 * rejects anything not signed with our TWILIO_AUTH_TOKEN, so a stranger can't
 * forge opt-outs for other people's numbers.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitByIp } from "@/lib/rate-limit-helpers";
import {
  classifyInboundSms,
  phoneKey,
  verifyTwilioSignature,
} from "@/lib/sms-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TwiML XML response with a single message (or empty when body is null). */
function twiml(message: string | null): NextResponse {
  const inner = message
    ? `<Message>${message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</Message>`
    : "";
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://sollos3.com"
  ).replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  // Generous IP cap — Twilio is the only legitimate caller; this just blunts
  // a flood against the endpoint.
  const limited = await rateLimitByIp(req, "sms-inbound", 600, 60_000);
  if (limited) return limited;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Can't verify the signature without it — refuse rather than trust blindly.
    console.error("[sms/inbound] TWILIO_AUTH_TOKEN not set — cannot verify signature");
    return NextResponse.json({ error: "SMS not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  const host = req.headers.get("host");
  const candidateUrls = [
    `${appBaseUrl()}/api/sms/inbound`,
    ...(host ? [`https://${host}/api/sms/inbound`] : []),
  ];

  if (
    !verifyTwilioSignature({
      candidateUrls,
      params,
      signature: req.headers.get("x-twilio-signature"),
      authToken,
    })
  ) {
    console.warn("[sms/inbound] signature verification failed");
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  const from = params.get("From");
  const to = params.get("To");
  const body = (params.get("Body") ?? "").trim();
  const firstWord = body.split(/\s+/)[0]?.toUpperCase() ?? ""; // for logging
  const intent = classifyInboundSms(body);
  const isStop = intent === "stop";
  const isStart = intent === "start";
  const isHelp = intent === "help";

  // Nothing actionable (a real reply / question) — ack with no auto-reply.
  if (!isStop && !isStart && !isHelp) {
    return twiml(null);
  }

  const admin = createSupabaseAdminClient();

  // Resolve the org from the number that was texted.
  const { data: orgRow } = (await admin
    .from("organizations")
    .select("id, name, contact_phone")
    .eq("sms_from_number" as never, to as never)
    .maybeSingle()) as unknown as {
    data: { id: string; name: string; contact_phone: string | null } | null;
  };

  if (!orgRow) {
    console.warn(`[sms/inbound] no org for To=${to}; keyword=${firstWord}`);
    // Still answer HELP generically; can't map opt-out without an org.
    return isHelp
      ? twiml("For help, contact the business that messaged you. Reply STOP to unsubscribe.")
      : twiml(null);
  }

  if (isHelp) {
    const contact = orgRow.contact_phone ? ` at ${orgRow.contact_phone}` : "";
    return twiml(
      `${orgRow.name}: For help, contact us${contact}. Reply STOP to unsubscribe.`,
    );
  }

  // STOP / START — update every client in this org whose phone matches the
  // sender (normalized to the last 10 digits so stored-format differences
  // don't cause a miss).
  const fromKey = phoneKey(from);
  if (fromKey.length === 10) {
    const { data: clients } = (await admin
      .from("clients")
      .select("id, phone")
      .eq("organization_id", orgRow.id)
      .not("phone", "is", null)) as unknown as {
      data: Array<{ id: string; phone: string | null }> | null;
    };

    const matchIds = (clients ?? [])
      .filter((c) => phoneKey(c.phone) === fromKey)
      .map((c) => c.id);

    if (matchIds.length > 0) {
      const update = isStop
        ? { sms_opted_in: false, sms_opted_in_at: null, sms_opt_in_source: null }
        : {
            sms_opted_in: true,
            sms_opted_in_at: new Date().toISOString(),
            sms_opt_in_source: "sms_start_reply",
          };
      const { error } = await (admin
        .from("clients")
        .update(update as never)
        .in("id", matchIds) as unknown as Promise<{ error: { message: string } | null }>);
      if (error) {
        console.error(`[sms/inbound] opt-${isStop ? "out" : "in"} update failed:`, error.message);
      } else {
        console.log(
          `[sms/inbound] ${isStop ? "opted out" : "opted in"} ${matchIds.length} client(s) in org ${orgRow.id} (From=${from})`,
        );
      }
    } else {
      console.warn(
        `[sms/inbound] ${firstWord} from ${from} matched no client in org ${orgRow.id}`,
      );
    }
  }

  // Mandatory confirmation reply.
  if (isStop) {
    return twiml(
      `${orgRow.name}: You're unsubscribed and won't receive more messages. Reply START to resubscribe.`,
    );
  }
  return twiml(
    `${orgRow.name}: You're resubscribed. Reply STOP to unsubscribe.`,
  );
}
