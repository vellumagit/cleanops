import { NextResponse, after, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enterFailClosed } from "@/lib/supabase/query-guard";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { sendEmail, getOrgSender, withinOrgEmailCap } from "@/lib/email";
import { escapeHtml as e } from "@/lib/support-mail";
import { readRequestBody } from "@/lib/request-body";
import {
  parseSocialLead,
  socialLeadDetails,
  socialLeadTitle,
} from "@/lib/social-lead";
import {
  getLeadAlertTargets,
  composeLeadAlertSms,
  sendLeadAlertTexts,
} from "@/lib/lead-alerts";

/**
 * Social and chat leads — ManyChat, GoHighLevel, Zapier, Make.
 *
 *   POST /api/social-lead/<form-token>   (or /api/intake/<form-token>)
 *
 * The contact form's sibling for leads that started in an Instagram DM, a
 * Facebook lead ad or a chat flow. Three things differ from the contact
 * form, each because a chat tool is not a website visitor:
 *
 *   - No confirmation email. The person is mid-conversation in the chat
 *     tool, which does its own replying; a "thanks for contacting us" email
 *     from Sollos to someone who sent a DM reads as spam.
 *   - Rate limits are per FORM, not per sender address. Every ManyChat or
 *     GoHighLevel customer posts from the same few servers; a per-address
 *     limit made one Sollos org's campaign use up another's allowance.
 *   - No `website` spam trap. A GoHighLevel contact has a real website
 *     field. See src/lib/social-lead.ts.
 *
 * One submission: a LEAD with its network as the source (an existing client
 * is never demoted), a request in the inbox, an in-app notification, and the
 * lead alert email/text.
 */

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  enterFailClosed();
  const { token } = await params;

  // A coarse flood guard ahead of the database read only. Generous on
  // purpose: this address is shared by every org whose chat tool runs on
  // the same servers. The real limits are per form, below.
  const flood = await checkIpRateLimit("social-lead", 600, 60_000);
  if (!flood.allowed) return json({ error: "too_many_requests" }, 429);

  const admin = createSupabaseAdminClient();
  const { data: form } = (await admin
    .from("intake_forms" as never)
    .select("id, organization_id, type, active")
    .eq("token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      type: string;
      active: boolean;
    } | null;
  };
  if (!form || form.type !== "social_lead" || !form.active) {
    return json({ error: "not_found" }, 404);
  }
  const orgId = form.organization_id;

  // A campaign can bring a burst; a leaked URL must not bring a flood.
  const perMinute = await checkRateLimit(`social-lead:${form.id}:m`, 30, 60_000);
  const perHour = perMinute.allowed
    ? await checkRateLimit(`social-lead:${form.id}:h`, 300, 3_600_000)
    : perMinute;
  if (!perMinute.allowed || !perHour.allowed) {
    return json({ error: "too_many_requests" }, 429);
  }

  const parsed = parseSocialLead(await readRequestBody(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const lead = parsed.lead;

  const clientId = await findOrCreateClient(
    admin,
    orgId,
    {
      name: lead.name,
      email: lead.email ?? undefined,
      phone: lead.phone ?? undefined,
      address: lead.place ?? undefined,
    },
    { createAs: "lead", leadSource: lead.source, matchPhone: true, matchName: false },
  );
  if (!clientId) {
    console.error("[social-lead] could not resolve client for", lead.name);
    return json({ error: "client_failed" }, 500);
  }

  const title = socialLeadTitle(lead.source);
  const detailBlock = socialLeadDetails(lead).join("\n");

  // Onto the note, as the contact form does: lifecycle and stage were
  // settled by findOrCreateClient.
  {
    const { data: existing } = (await admin
      .from("clients")
      .select("lead_note")
      .eq("id", clientId)
      .maybeSingle()) as unknown as { data: { lead_note: string | null } | null };
    await admin
      .from("clients")
      .update({
        lead_note: [existing?.lead_note, `${title}\n${detailBlock}`.trim()]
          .filter(Boolean)
          .join("\n---\n")
          .slice(0, 4000),
      } as never)
      .eq("id", clientId);
  }

  // And a REQUEST — the same inbox as website inquiries, auto-resolved when
  // the lead converts or goes lost.
  {
    const { error: reqErr } = (await admin
      .from("client_job_requests" as never)
      .insert({
        organization_id: orgId,
        client_id: clientId,
        kind: "job_note",
        body: `${title}\n${detailBlock || "(no message)"}`.slice(0, 4000),
        status: "open",
      } as never)) as unknown as { error: { message: string } | null };
    if (reqErr) console.error("[social-lead] request insert failed:", reqErr.message);
  }

  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: orgId,
      audience: "org-admins",
      topic: "clients",
      type: "general",
      title: lead.source === "social" ? "New social or chat lead" : `New ${title}`,
      body: `${lead.name}${lead.handle ? ` (${lead.handle})` : ""}: ${
        lead.message ? lead.message.slice(0, 120) : "no message"
      }`,
      href: `/app/leads`,
    });
  } catch (err) {
    console.error("[social-lead] notify failed:", err);
  }

  // Emails and texts finish in after(), so a send still in flight isn't
  // frozen with the function once the response goes back.
  const pending: Promise<unknown>[] = [];
  after(() => Promise.allSettled(pending));

  const targets = await getLeadAlertTargets(orgId);
  try {
    const recipients = targets.emailOn ? targets.emails : [];
    if (recipients.length > 0) {
      const sender = await getOrgSender(orgId);
      const rows = [
        ["Name", e(lead.name)],
        lead.handle ? ["Handle", e(lead.handle)] : null,
        lead.email
          ? ["Email", `<a href="mailto:${e(lead.email)}" style="color:#2c5a2a;">${e(lead.email)}</a>`]
          : null,
        lead.phone
          ? ["Phone", `<a href="tel:${e(lead.phone)}" style="color:#2c5a2a;">${e(lead.phone)}</a>`]
          : null,
        lead.place ? ["Location", e(lead.place)] : null,
      ]
        .filter((r): r is [string, string] => Boolean(r))
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;width:120px;font-size:13px;font-weight:800;color:#1f2937;">${k}</td><td style="padding:6px 0;font-size:13px;color:#1f2937;">${v}</td></tr>`,
        )
        .join("");
      const subject = `${title} — ${lead.name}`;
      for (const to of recipients) {
        // Counts against the org's daily cap, like every other send.
        const cap = await withinOrgEmailCap(orgId);
        if (!cap.ok) {
          console.warn(`[social-lead] org ${orgId} not emailed: ${cap.reason}`);
          break;
        }
        pending.push(
          sendEmail({
            to,
            subject,
            from: sender.from,
            fromName: sender.fromName,
            html: `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f7f8f6;font-family:system-ui,sans-serif;padding:20px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid rgba(17,24,39,.1);border-radius:14px;overflow:hidden;">
<div style="padding:16px 18px;background:#2c5a2a;color:#fff;font-size:14px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;">${e(title)}</div>
<div style="padding:18px;">
<div style="background:#eef5ec;border:1px solid #b8d4b5;border-radius:12px;padding:14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
${lead.message ? `<p style="margin:10px 0 4px 0;font-size:13px;font-weight:900;color:#1f2937;">Message</p><div style="font-size:13px;line-height:1.75;color:#374151;white-space:pre-line;">${e(lead.message)}</div>` : ""}
</div>
<div style="margin-top:16px;"><a href="https://sollos3.com/app/leads" style="color:#2c5a2a;font-weight:800;text-decoration:none;">Open in Sollos →</a> — the lead is already in your list.</div>
</div></div></body></html>`,
            text: `${subject}\n${[lead.handle, lead.email, lead.phone, lead.place].filter(Boolean).join("\n")}\n\n${lead.message ?? ""}\n\nOpen: https://sollos3.com/app/leads`,
          }).catch((err) => console.error("[social-lead] internal email:", err)),
        );
      }
    }
  } catch (err) {
    console.error("[social-lead] internal notify failed:", err);
  }

  pending.push(
    sendLeadAlertTexts(
      orgId,
      targets.phones,
      composeLeadAlertSms({
        orgName: targets.orgName,
        kind: "inquiry",
        name: lead.handle && lead.handle !== lead.name ? `${lead.name} (${lead.handle})` : lead.name,
        phone: lead.phone,
        email: lead.email,
        place: lead.place,
        summary: lead.message,
        path: "/app/leads",
      }),
    ),
  );

  // The id lets a chat tool store it on its own contact (ManyChat and
  // GoHighLevel can both map a response field to a custom field).
  return json({ ok: true, lead_id: clientId }, 201);
}
