import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { findOrCreateClient } from "@/lib/find-or-create-client";
import { newLeadPatch, type LeadSource } from "@/lib/lead-pipeline";
import { sendEmail, getOrgSender } from "@/lib/email";

/**
 * Public estimate-request intake — the website's quote calculator posts
 * straight here. This endpoint replaces an entire make.com scenario
 * (webhook → client email → internal email → sleep → HTTP to the v1 API)
 * with one native handler, and fixes what that pipeline silently lost:
 * the v1 call carried only name/email/total/schedule, so phone, address,
 * property details, notes, source, and the recurring price never reached
 * Sollos — they lived only in a notification email.
 *
 * Accepts the EXACT payload the website already sends to make.com
 * (fullName, email, phone, address, city, bedrooms…, priceInitialHigh…),
 * so cutover is a one-line URL swap on the site. Token-scoped per org via
 * intake_forms (type "estimate_request"), IP rate-limited, CORS-open —
 * it's a lead form; the token is the gate, not the browser.
 *
 * What one submission produces:
 *   1. A LEAD (or a note on the existing client — an active client asking
 *      for a quote is not demoted back to lead).
 *   2. A draft estimate carrying EVERYTHING the calculator computed.
 *   3. A branded confirmation email to the client (org sender, org phone).
 *   4. An internal email to the org's owners/admins + an in-app
 *      notification.
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

function yn(v: unknown): string {
  if (v === 1 || v === "1" || v === true || v === "yes") return "yes";
  if (v === 0 || v === "0" || v === false || v === "no" || v == null) return "no";
  return s(v, 40);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const rl = await checkIpRateLimit("estimate-request", 10, 60_000);
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
  if (!form || form.type !== "estimate_request" || !form.active) {
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

  const fullName = s(body.fullName ?? body.name, 200);
  if (!fullName) {
    return NextResponse.json(
      { error: "name_required" },
      { status: 400, headers: CORS },
    );
  }
  const email = s(body.email, 320);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phone = s(body.phone, 40);
  const address = s(body.address, 300);
  const city = s(body.city, 100);
  const notes = s(body.notes, 2000);
  const schedule = s(body.schedule, 60);
  const cleaningDate = s(body.cleaningDate, 30);
  const hearAboutUs = s(body.hearAboutUs, 100);

  const initialHigh = Number(body.priceInitialHigh);
  const recurringHigh = Number(body.priceRecurringHigh);
  const totalCents =
    Number.isFinite(initialHigh) && initialHigh > 0
      ? Math.round(initialHigh * 100)
      : 0;

  // ── 1. The lead ─────────────────────────────────────────────────────────
  const clientId = await findOrCreateClient(
    admin,
    orgId,
    {
      name: fullName,
      email: emailOk ? email : undefined,
      phone: phone || undefined,
      address: [address, city].filter(Boolean).join(", ") || undefined,
    },
    { createAs: "lead" },
  );
  if (!clientId) {
    console.error("[estimate-request] could not resolve client for", fullName);
    return NextResponse.json(
      { error: "client_failed" },
      { status: 500, headers: CORS },
    );
  }

  const detailLines = [
    schedule && `Schedule: ${schedule}`,
    cleaningDate && `Wants cleaning on: ${cleaningDate}`,
    `Property: ${s(body.bedrooms, 10) || "?"} bed, ${s(body.bathrooms, 10) || "?"} bath${
      body.kitchens != null ? `, ${s(body.kitchens, 10)} kitchen` : ""
    }`,
    `Pets: ${yn(body.pets)}`,
    `Add-ons: oven ${yn(body.oven)}, fridge ${yn(body.fridge)}, windows ${yn(
      body.windows,
    )}, blinds ${yn(body.blinds)}, carpets ${yn(body.carpets)}`,
    Number.isFinite(initialHigh) &&
      `Calculator quote — initial: $${initialHigh}${
        Number.isFinite(recurringHigh) ? `, recurring: $${recurringHigh}` : ""
      }`,
    body.travelFee != null && `Travel fee: $${s(body.travelFee, 20)}`,
    hearAboutUs && `Heard about us: ${hearAboutUs}`,
    notes && `Notes: ${notes}`,
  ].filter(Boolean) as string[];
  const detailBlock = detailLines.join("\n");

  // Lead fields — but never demote an existing ACTIVE client back to lead.
  // A regular client price-shopping the website is still a client.
  const { data: existing } = (await admin
    .from("clients")
    .select("lifecycle, lead_note")
    .eq("id", clientId)
    .maybeSingle()) as unknown as {
    data: { lifecycle: string | null; lead_note: string | null } | null;
  };
  const source: LeadSource =
    hearAboutUs.toLowerCase() === "referral" ? "referral" : "web_form";
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

  // ── 2. The estimate — carrying everything the calculator computed ───────
  const { data: estimate, error: estErr } = (await admin
    .from("estimates")
    .insert({
      organization_id: orgId,
      client_id: clientId,
      status: "draft",
      total_cents: totalCents,
      service_description: schedule || "estimate request",
      notes: detailBlock || null,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (estErr || !estimate) {
    console.error(
      "[estimate-request] estimate insert failed:",
      estErr?.message,
    );
    return NextResponse.json(
      { error: "estimate_failed" },
      { status: 500, headers: CORS },
    );
  }

  // ── 3. Confirmation to the client ───────────────────────────────────────
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
    const summaryRows = [
      `<div class="detail-item"><strong>Property:</strong> ${s(body.bedrooms, 10) || "?"} Bed, ${s(body.bathrooms, 10) || "?"} Bath</div>`,
      cleaningDate &&
        `<div class="detail-item"><strong>Planned date:</strong> ${cleaningDate}</div>`,
      address &&
        `<div class="detail-item"><strong>Address:</strong> ${address}</div>`,
    ]
      .filter(Boolean)
      .join("\n");
    const cta = orgPhone
      ? `<div class="cta-box"><div style="font-weight:700;margin-bottom:5px;">Call for instant booking:</div><a href="tel:${orgPhone}" style="font-size:20px;font-weight:800;color:#111827;text-decoration:none;">${orgPhone}</a></div>`
      : `<div class="cta-box">Reply to this email any time — we're happy to help.</div>`;
    sendEmail({
      to: email,
      toName: fullName,
      subject: `${orgName} — your quote request is being reviewed, ${fullName}`,
      from: sender.from,
      fromName: sender.fromName,
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body{margin:0;padding:0;background:#f7f8f6;font-family:system-ui,-apple-system,sans-serif}
.wrapper{background:#f7f8f6;padding:40px 20px}
.card{max-width:600px;margin:0 auto;background:#fff;border:1px solid rgba(17,24,39,.10);border-radius:14px;overflow:hidden}
.header{padding:30px 25px;border-bottom:1px solid rgba(17,24,39,.08)}
.brand{font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#4e9a4a;font-weight:800}
.title{font-size:22px;color:#111827;font-weight:800;margin-top:6px}
.content{padding:25px;line-height:1.6;color:#374151;font-size:15px}
.details-box{background:#f8fafc;border:1px solid rgba(17,24,39,.10);border-radius:12px;padding:20px;margin:20px 0}
.detail-item{font-size:14px;margin-bottom:6px;color:#111827}
.detail-label{color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.5px}
.cta-box{background:#eef5ec;border:1px solid rgba(61,122,58,.20);border-radius:12px;padding:20px;text-align:center}
.footer{padding:25px;font-size:12px;color:#9ca3af;text-align:center}
</style></head><body><div class="wrapper"><div class="card">
<div class="header"><div class="brand">${orgName}</div><div class="title">Request received ✅</div></div>
<div class="content">Hi ${fullName},<br><br>
Thanks for reaching out! We've received your service request${city ? ` for your property in <strong>${city}</strong>` : ""}. We're reviewing your details to make sure your quote is accurate.
<div class="details-box"><div class="detail-label">Service summary</div>
${summaryRows}</div>
<p><strong>What happens next?</strong></p>
<p>We'll be in touch shortly to confirm availability and finalize your quote.</p>
${cta}
</div>
<div class="footer">${orgName}</div>
</div></div></body></html>`,
      text: `Hi ${fullName},\n\nThanks for reaching out! We've received your service request and we're reviewing the details to make sure your quote is accurate. We'll be in touch shortly.\n\n${orgName}${orgPhone ? ` · ${orgPhone}` : ""}`,
    }).catch((err) => console.error("[estimate-request] client email:", err));
  }

  // ── 4. Internal: the org's owners hear about it, in-app and by email ────
  try {
    const { notify } = await import("@/lib/notify");
    await notify({
      organizationId: orgId,
      audience: "org-admins",
      // "general" — the notification_type enum has no "lead" value, and an
      // invalid enum makes the insert vanish into a caught error. The title
      // carries the meaning; the enum just has to not reject the row.
      type: "general",
      title: "New estimate request",
      body: `${fullName}${city ? ` (${city})` : ""} — ${
        schedule || "estimate"
      }${totalCents ? `, quoted ~$${(totalCents / 100).toFixed(0)}` : ""}. Lead + draft estimate created.`,
      href: `/app/estimates`,
    });
  } catch (err) {
    console.error("[estimate-request] notify failed:", err);
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
    const grid = detailLines
      .map(
        (l) =>
          `<div style="border-bottom:1px solid #eef2f6;padding:6px 0;font-size:14px;color:#111827;">${l}</div>`,
      )
      .join("\n");
    for (const to of recipients) {
      sendEmail({
        to,
        subject: `New estimate request — ${fullName}`,
        from: sender.from,
        fromName: sender.fromName,
        html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f8f6;font-family:system-ui,sans-serif;padding:20px;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid rgba(17,24,39,.1);border-radius:14px;overflow:hidden;">
<div style="padding:20px 25px;background:#111827;border-bottom:4px solid #4e9a4a;">
<div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#fff;font-weight:800;opacity:.8;">${orgName}</div>
<div style="font-size:20px;color:#fff;font-weight:800;margin-top:4px;">New estimate request</div></div>
<div style="padding:25px;">
<div style="font-size:14px;color:#111827;margin-bottom:12px;"><strong>${fullName}</strong>${phone ? ` · ${phone}` : ""}${emailOk ? ` · ${email}` : ""}</div>
${address ? `<div style="font-size:13px;color:#374151;margin-bottom:12px;">${address}${city ? `, ${city}` : ""}</div>` : ""}
<div style="background:#f8fafc;border:1px solid rgba(17,24,39,.08);border-radius:12px;padding:15px;">${grid}</div>
<div style="margin-top:20px;"><a href="https://sollos3.com/app/estimates" style="color:#4e9a4a;font-weight:700;text-decoration:none;">Open in Sollos →</a> — the lead and a draft estimate are already there.</div>
</div></div></body></html>`,
        text: `New estimate request — ${fullName}\n${phone}\n${email}\n${address}, ${city}\n\n${detailBlock}\n\nOpen: https://sollos3.com/app/estimates`,
      }).catch((err) =>
        console.error("[estimate-request] internal email:", err),
      );
    }
  } catch (err) {
    console.error("[estimate-request] internal notify failed:", err);
  }

  return NextResponse.json(
    { ok: true, estimate_id: estimate.id },
    { status: 201, headers: CORS },
  );
}
