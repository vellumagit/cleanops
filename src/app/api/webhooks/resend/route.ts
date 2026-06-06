/**
 * Resend webhook handler — auto-populates the email_suppressions list on
 * bounces and complaints so we stop hammering bad addresses.
 *
 * Configuration:
 *   1. Set RESEND_WEBHOOK_SECRET in Vercel env (the "Signing Secret"
 *      shown when you create a webhook endpoint in the Resend dashboard).
 *   2. In Resend → Webhooks, add endpoint:
 *        https://sollos3.com/api/webhooks/resend
 *      Subscribe to events:
 *        - email.bounced
 *        - email.complained
 *      (We don't currently care about delivered / opened / clicked.)
 *
 * Security:
 *   - Signature verified via Svix HMAC-SHA256 against RESEND_WEBHOOK_SECRET
 *     (Resend uses Svix under the hood, same scheme as Clerk / others).
 *   - Idempotency via the unique index on email_suppressions.provider_event_id —
 *     redelivered webhooks are no-ops.
 *   - Service role used for the DB write (anon/authenticated have no
 *     access to email_suppressions per the migration).
 *
 * Event shape (abbreviated):
 *   {
 *     type: "email.bounced" | "email.complained" | ...,
 *     created_at: "2026-06-02T...",
 *     data: { email_id, to: [...], subject, bounce: {...}, ... }
 *   }
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { addEmailSuppression } from "@/lib/email-suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    [key: string]: unknown;
  };
};

/**
 * Verify the Svix signature header. Resend uses Svix's webhook signing
 * scheme: the signed payload is `${svix-id}.${svix-timestamp}.${body}`,
 * HMAC-SHA256 with the base64-decoded secret (after stripping the
 * "whsec_" prefix), base64-encoded.
 *
 * The svix-signature header can contain multiple signatures separated
 * by spaces (for key rotation) — we accept the request if any of them
 * matches.
 */
function verifySvixSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject timestamps older than 5 minutes — defends against replay.
  const tsSec = Number(svixTimestamp);
  if (!Number.isFinite(tsSec)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > 5 * 60) return false;

  // Strip "whsec_" prefix and base64-decode the secret.
  const cleanSecret = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(cleanSecret, "base64");
  } catch {
    return false;
  }

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedPayload)
    .digest("base64");

  // Header format: "v1,<sig1> v1,<sig2> ..." — check each.
  for (const part of svixSignature.split(" ")) {
    const [, sig] = part.split(",");
    if (!sig) continue;
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (
      expectedBuf.length === sigBuf.length &&
      timingSafeEqual(new Uint8Array(expectedBuf), new Uint8Array(sigBuf))
    ) {
      return true;
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend-webhook] RESEND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const rawBody = await request.text();

  if (!verifySvixSignature(rawBody, request.headers, secret)) {
    console.warn("[resend-webhook] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ResendWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resend's per-event id used for idempotency. Falls back to a
  // hash-of-payload if the field is missing in some future event shape.
  const eventId = (event.data?.email_id ?? null) as string | null;

  // Extract recipient address(es). Resend sends `to` as an array on
  // bounce/complaint events; we suppress each one.
  const recipients: string[] = Array.isArray(event.data?.to)
    ? (event.data?.to as string[])
    : event.data?.to
      ? [event.data.to as string]
      : [];

  let reason: "bounced" | "complained" | null = null;
  if (event.type === "email.bounced") reason = "bounced";
  else if (event.type === "email.complained") reason = "complained";

  if (!reason) {
    // We don't care about delivered / opened / clicked etc — ack and
    // move on so Resend doesn't retry.
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  if (recipients.length === 0) {
    console.warn(
      "[resend-webhook] no recipients on bounce/complaint event:",
      eventId,
    );
    return NextResponse.json({ ok: true, ignored: "no recipients" });
  }

  let suppressed = 0;
  for (const email of recipients) {
    const result = await addEmailSuppression({
      email,
      reason,
      providerEventId: eventId,
      eventPayload: event,
    });
    if (result.ok) suppressed += 1;
    else
      console.error(
        "[resend-webhook] suppression upsert failed:",
        email,
        result.error,
      );
  }

  console.log(
    `[resend-webhook] ${reason}: suppressed ${suppressed}/${recipients.length} addresses`,
  );

  return NextResponse.json({ ok: true, suppressed });
}
