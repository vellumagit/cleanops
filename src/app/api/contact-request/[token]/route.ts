import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { newLeadPatch, type LeadSource } from "@/lib/lead-pipeline";
import { sendEmail, getOrgSender } from "@/lib/email";

/**
 * Public contact-form intake — the website's contact form posts here.
 *
 * Sibling of /api/estimate-request/[token], replacing the make.com
 * "Lead Form - Response" scenario — which, notably, had been INACTIVE and
 * invalid since February: contact submissions were reaching nobody. Same
 * payload the form already sends (name, email, phone, city, urgency,
 * notes, page_url, referrer + the empty `website` honeypot), so cutover
 * is a URL swap.
 *
 * One submission produces: a LEAD with the message and urgency in its
 * note (existing active clients are never demoted), a confirmation email
 * to the sender, an internal email to the org's owners/admins with
 * mailto/tel quick actions, and an in-app notification. Bots that fill
 * the honeypot get a cheerful 201 and nothing else.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function s(v: unknown, cap = 300): string {
  return String(v ?? "").trim().slice(0, cap);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const rl = await checkIpRateLimit("contact-request", 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: CORS },
    );
  }

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
  if (!form || form.type !== "contact" || !form.active) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: CORS },
    );
  }
  const orgId = form.organization_id;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400, headers: CORS },
    );
  }

  // Honeypot: the form ships an invisible `website` field. Humans leave it
  // empty; bots helpfully fill it in. They get a success and we get peace.
  if (s(body.website, 100)) {
    return NextResponse.json({ ok: true }, { status: 201, headers: CORS });
  }

  const name = s(body.name ?? body.fullName, 200);
  if (!name) {
    return NextResponse.json(
      { error: "name_required" },
      { status: 400, headers: CORS },
    );
  }
  const email = s(body.email, 320);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phone = s(body.phone, 40);
  const city = s(body.city, 100);
  const urgency = s(body.urgency, 60);
  const notes = s(body.notes ?? body.message, 2000);
  const pageUrl = s(body.page_url, 300);
  const referrer = s(body.referrer, 300);

  const clientId = await findOrCreateClient(
    admin,
    orgId,
    {
      name,
      email: emailOk ? email : undefined,
      phone: phone || undefined,
      address: city || undefined,
    },
    { createAs: "lead" },
  );
  if (!clientId) {
    console.error("[contact-request] could not resolve client for", name);
    return NextResponse.json(
      { error: "client_failed" },
      { status: 500, headers: CORS },
    );
  }

  const detailLines = [
    notes && `Message: ${notes}`,
    urgency && `Urgency: ${urgency}`,
    city && `City: ${city}`,
    pageUrl && `From page: ${pageUrl}`,
    referrer && `Referred by: ${referrer}`,
  ].filter(Boolean) as string[];
  const detailBlock = detailLines.join("\n");

  const { data: existing } = (await admin
    .from("clients")
    .select("lifecycle, lead_note")
    .eq("id", clientId)
    .maybeSingle()) as unknown as {
    data: { lifecycle: string | null; lead_note: string | null } | null;
  };
  const source: LeadSource = "web_form";
  const patch: Record<string, unknown> = {
    lead_note: [existing?.lead_note, detailBlock]
      .filter(Boolean)
      .join("\n---\n")
      .slice(0, 4000),
  };
  if (existing?.lifecycle !== "client") {
    Object.assign(patch, newLeadPatch(source));
  }
  await admin.from("clients").update(patch).eq("id", clientId);

  const sender = await getOrgSender(orgId);
  const { data: orgRow } = (await admin
    .from("organizations")
    .select("name, contact_phone")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: { name: string; contact_phone: string | null } | null;
  };
  const orgName = orgRow?.name ?? "Our team";
  const orgPhone = orgRow?.contact_phone ?? null;

  if (emailOk) {
    const received = [
      `<strong>Name:</strong> ${name}`,
      `<strong>Email:</strong> ${email}`,
      phone && `<strong>Phone:</strong> ${phone}`,
      notes && `<strong>Message:</strong> ${notes}`,
    ]
      .filter(Boolean)
      .join("<br>");
    sendEmail({
      to: email,
      toName: name,
      subject: `${name}, we've received your message ✨`,
      from: sender.from,
      fromName: sender.fromName,
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f8f6;font-family:system-ui,-apple-system,sans-serif;">
<div style="padding:24px 16px;"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid rgba(17,24,39,.10);border-radius:12px;overflow:hidden;">
<div style="padding:18px 20px;background:#2c5a2a;color:#fff;font-size:16px;font-weight:700;">${orgName}</div>
<div style="padding:22px 20px;color:#1a1a1a;">
<h1 style="margin:0 0 10px 0;font-size:22px;">Thanks — we received your request ✅</h1>
<p style="margin:0 0 14px 0;font-size:14px;line-height:1.75;color:#4b5563;">Hi ${name},<br>Thanks for contacting <strong>${orgName}</strong>. We've got your message and we'll reply shortly.</p>
${orgPhone ? `<p style="margin:0 0 14px 0;font-size:14px;color:#4b5563;">If it's time-sensitive, calling is fastest: <a href="tel:${orgPhone}" style="color:#2c5a2a;font-weight:800;text-decoration:none;">${orgPhone}</a></p>` : ""}
<div style="background:#eef5ec;border:1px solid #b8d4b5;border-radius:12px;padding:14px;">
<p style="margin:0 0 6px 0;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#2c5a2a;font-weight:800;">What we received</p>
<p style="margin:0;font-size:13px;line-height:1.7;color:#1f2937;">${received}</p></div>
<p style="margin:14px 0 0 0;font-size:13px;line-height:1.75;color:#4b5563;">Typical response time: <strong>within 1 business day</strong>.</p>
</div>
<div style="padding:14px 20px 20px;font-size:12px;color:#6b7280;border-top:1px solid rgba(17,24,39,.10);">${orgName}</div>
</div>
<div style="margin-top:14px;font-size:11px;color:#9ca3af;text-align:center;">If you didn't submit a request, you can ignore this email.</div>
</div></body></html>`,
      text: `Hi ${name},\n\nThanks for contacting ${orgName}. We've got your message and we'll reply shortly — typically within 1 business day.${orgPhone ? `\nIf it's time-sensitive, calling is fastest: ${orgPhone}` : ""}\n\n${orgName}`,
    }).catch((err) => console.error("[contact-request] client email:", err));
  }

  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: orgId,
      audience: "org-admins",
      type: "general",
      title: "New website inquiry",
      body: `${name}${city ? ` (${city})` : ""}${
        urgency ? ` — ${urgency}` : ""
      }: ${notes ? notes.slice(0, 120) : "no message"}`,
      href: `/app/leads`,
    });
  } catch (err) {
    console.error("[contact-request] notify failed:", err);
  }

  try {
    const { data: adminRows } = (await admin
      .from("memberships")
      .select("role, status, contact_email, profile:profiles ( email )")
      .eq("organization_id", orgId)
      .in("role", ["owner", "admin"])
      .eq("status", "active")) as unknown as {
      data: Array<{
        contact_email: string | null;
        profile: { email: string | null } | null;
      }> | null;
    };
    const recipients = [
      ...new Set(
        (adminRows ?? [])
          .map((r) => r.contact_email ?? r.profile?.email ?? "")
          .filter((e) => e.includes("@")),
      ),
    ];
    const rows = [
      ["Name", name],
      emailOk ? ["Email", `<a href="mailto:${email}" style="color:#2c5a2a;">${email}</a>`] : null,
      phone ? ["Phone", `<a href="tel:${phone}" style="color:#2c5a2a;">${phone}</a>`] : null,
      city ? ["Location", city] : null,
      urgency ? ["Urgency", urgency] : null,
    ]
      .filter((r): r is [string, string] => Boolean(r))
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;width:120px;font-size:13px;font-weight:800;color:#1f2937;">${k}</td><td style="padding:6px 0;font-size:13px;color:#1f2937;">${v}</td></tr>`,
      )
      .join("");
    for (const to of recipients) {
      sendEmail({
        to,
        subject: `New website inquiry — ${name}`,
        from: sender.from,
        fromName: sender.fromName,
        html: `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f7f8f6;font-family:system-ui,sans-serif;padding:20px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid rgba(17,24,39,.1);border-radius:14px;overflow:hidden;">
<div style="padding:16px 18px;background:#2c5a2a;color:#fff;font-size:14px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;">New website inquiry</div>
<div style="padding:18px;">
<div style="background:#eef5ec;border:1px solid #b8d4b5;border-radius:12px;padding:14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
${notes ? `<p style="margin:10px 0 4px 0;font-size:13px;font-weight:900;color:#1f2937;">Message</p><div style="font-size:13px;line-height:1.75;color:#374151;white-space:pre-line;">${notes}</div>` : ""}
</div>
<div style="margin-top:16px;"><a href="https://sollos3.com/app/leads" style="color:#2c5a2a;font-weight:800;text-decoration:none;">Open in Sollos →</a> — the lead is already in your list.</div>
</div></div></body></html>`,
        text: `New website inquiry — ${name}\n${email}\n${phone}\n${city}${urgency ? `\nUrgency: ${urgency}` : ""}\n\n${notes}\n\nOpen: https://sollos3.com/app/leads`,
      }).catch((err) =>
        console.error("[contact-request] internal email:", err),
      );
    }
  } catch (err) {
    console.error("[contact-request] internal notify failed:", err);
  }

  return NextResponse.json({ ok: true }, { status: 201, headers: CORS });
}
