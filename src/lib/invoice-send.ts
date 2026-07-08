/**
 * Invoice email delivery — the membership-free core.
 *
 * Extracted from src/app/app/invoices/actions.ts so BOTH the owner-facing
 * "Send invoice" action AND the invoice-auto-send cron share one delivery
 * routine (same template, same PDF attach, same gates) — no drift between
 * hand-sent and auto-sent invoices. This module derives everything from the
 * invoice's own organization_id via the admin client; it does NO auth, so the
 * action wrapper keeps the owner/admin permission check.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendOrgEmailDetailed, isEmailConfigured } from "@/lib/email";
import { invoiceSentEmail } from "@/lib/email-templates";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { pushInvoiceToSage } from "@/lib/sage";

export type SendInvoiceState = {
  error?: string;
  ok?: boolean;
  /** Resend message id on success. */
  messageId?: string;
  /**
   * Failure is permanent (won't fix itself on retry) — e.g. the client has no
   * email. The auto-send cron marks these 'skipped' and alerts the owner;
   * everything else is treated as transient and retried next pass.
   */
  permanent?: boolean;
  /**
   * The email WAS delivered but the follow-up status write failed. The cron
   * uses this to stop re-sending (avoids a duplicate) even though recording
   * was incomplete.
   */
  delivered?: boolean;
};

/**
 * Render + deliver the invoice email. Reads the invoice + client + org branding
 * from the invoice's org, runs every configuration / data gate, attaches the
 * rendered PDF, and hands off to Resend. Does NOT touch the invoices table —
 * callers decide whether to flip status.
 */
export async function deliverInvoiceEmailCore(
  invoiceId: string,
): Promise<SendInvoiceState> {
  const db = createSupabaseAdminClient();

  const { data: prev } = await db
    .from("invoices")
    .select(
      "id, number, status, sent_at, public_token, amount_cents, due_date, organization_id, client:clients ( name, email )",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!prev) return { error: "Invoice not found." };

  const orgId = (prev as { organization_id: string }).organization_id;

  // Fetch tax columns separately — not yet in generated types.
  const { data: taxData } = (await db
    .from("invoices")
    .select("tax_rate_bps, tax_amount_cents, tax_label")
    .eq("id", invoiceId)
    .maybeSingle()) as unknown as {
    data: {
      tax_rate_bps: number | null;
      tax_amount_cents: number | null;
      tax_label: string | null;
    } | null;
  };

  const clientEmail = prev.client?.email;
  if (!clientEmail) {
    return {
      // Permanent: won't resolve on retry until the owner adds an email.
      permanent: true,
      error:
        "This client has no email address on file. Add one on the client's record first, then try again — or share the public invoice link manually.",
    };
  }
  if (!prev.public_token) {
    return {
      error:
        "This invoice is missing a public token. Refresh the page; if it persists, contact support.",
    };
  }

  if (!isEmailConfigured()) {
    return {
      error:
        "Email delivery isn't configured on this environment yet — the invoice wasn't sent. Contact support to enable sending, or share the public invoice link manually.",
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";
  const currency = await getOrgCurrency(orgId);

  const { data: orgData } = (await db
    .from("organizations")
    .select("name, brand_color, logo_url, contact_email, contact_phone")
    .eq("id", orgId)
    .maybeSingle()) as unknown as {
    data: {
      name: string;
      brand_color: string | null;
      logo_url: string | null;
      contact_email: string | null;
      contact_phone: string | null;
    } | null;
  };

  const taxAmountCents = taxData?.tax_amount_cents ?? null;
  const taxRateBps = taxData?.tax_rate_bps ?? null;
  const taxLabel = taxData?.tax_label ?? null;
  const subtotalCents = prev.amount_cents - (taxAmountCents ?? 0);
  const hasTax = taxAmountCents !== null && taxAmountCents > 0;

  const template = invoiceSentEmail({
    clientName: prev.client?.name ?? "there",
    invoiceNumber: prev.number ?? invoiceId.slice(0, 8).toUpperCase(),
    amountFormatted: formatCurrencyCents(prev.amount_cents, currency),
    dueDate: prev.due_date
      ? new Date(prev.due_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "On receipt",
    publicUrl: `${siteUrl}/i/${prev.public_token}`,
    pdfUrl: `${siteUrl}/api/i/${prev.public_token}/pdf`,
    orgName: orgData?.name ?? "Your service provider",
    brandColor: orgData?.brand_color ?? undefined,
    logoUrl: orgData?.logo_url ?? undefined,
    contactEmail: orgData?.contact_email,
    contactPhone: orgData?.contact_phone,
    subtotalFormatted: hasTax
      ? formatCurrencyCents(subtotalCents, currency)
      : null,
    taxAmountFormatted: hasTax
      ? formatCurrencyCents(taxAmountCents!, currency)
      : null,
    taxLineLabel: hasTax
      ? `${taxLabel || "Tax"}${
          taxRateBps
            ? ` (${(taxRateBps / 100).toFixed(2).replace(/\.?0+$/, "")}%)`
            : ""
        }`
      : null,
  });

  // Attach a PDF copy. The heavy Chromium render runs in the dedicated
  // /api/i/[token]/pdf route (memory + maxDuration tuned in vercel.json) — an
  // inline render here would silently fail, so we fetch the rendered PDF,
  // bounded by a timeout so a slow cold render never blocks the email (which
  // also carries a Download PDF link as a reliable fallback).
  let pdfAttachment:
    | { filename: string; content: Buffer; contentType: string }
    | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7_000);
    const res = await fetch(`${siteUrl}/api/i/${prev.public_token}/pdf`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const slug = String(prev.number ?? invoiceId.slice(0, 8))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      pdfAttachment = {
        filename: `invoice-${slug || invoiceId}.pdf`,
        content: buf,
        contentType: "application/pdf",
      };
    } else {
      console.error("[invoice] PDF route returned", res.status);
    }
  } catch (pdfErr) {
    console.error("[invoice] PDF attach failed (continuing without):", pdfErr);
  }

  const result = await sendOrgEmailDetailed(orgId, {
    to: clientEmail,
    toName: prev.client?.name ?? undefined,
    ...template,
    // Sending an invoice is operational — bypass the CLIENT_EMAILS_PAUSED kill
    // switch (matches the owner "Send" path). Automated receipts / overdue
    // reminders continue to respect it.
    pauseExempt: true,
    ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
  });
  if (!result.ok) {
    return {
      error: `Couldn't deliver the invoice email to ${clientEmail}. Resend said: "${result.reason}". Check Settings → Email sender and your Resend domain verification, then try again.`,
    };
  }
  return { ok: true, messageId: result.id };
}

/**
 * Stamp a freshly-drafted invoice with its auto-send schedule IF the org has
 * auto-send enabled. Best-effort — on any failure the invoice simply stays a
 * manual draft (fail-safe: we never accidentally send). `consolidated` marks
 * the biweekly/monthly billing-cycle path, which the org can opt out of
 * separately from per-job drafts.
 */
export async function scheduleAutoSendIfEnabled(
  invoiceId: string,
  orgId: string,
  opts?: { consolidated?: boolean },
): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const { data } = (await db
      .from("organizations")
      .select(
        "invoice_auto_send_enabled, invoice_auto_send_delay_hours, invoice_auto_send_consolidated",
      )
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: {
        invoice_auto_send_enabled: boolean;
        invoice_auto_send_delay_hours: number;
        invoice_auto_send_consolidated: boolean;
      } | null;
    };

    if (!data || !data.invoice_auto_send_enabled) return;
    if (opts?.consolidated && !data.invoice_auto_send_consolidated) return;

    const delayHours = Math.max(0, data.invoice_auto_send_delay_hours ?? 24);
    const at = new Date(Date.now() + delayHours * 3_600_000).toISOString();

    await (db
      .from("invoices")
      .update({ auto_send_at: at, auto_send_state: "scheduled" } as never)
      .eq("id", invoiceId) as unknown as Promise<unknown>);
  } catch (err) {
    console.error("[invoice-send] scheduleAutoSendIfEnabled failed:", err);
  }
}

/**
 * System-initiated send (no membership) for the auto-send cron: deliver, then
 * flip status draft → sent + stamp sent_at, then background-sync to Sage.
 * Send-first ordering, same as the manual action — if delivery fails, status
 * is untouched and the invoice stays a draft for the next attempt.
 */
export async function markInvoiceSentSystem(
  invoiceId: string,
): Promise<SendInvoiceState> {
  const delivered = await deliverInvoiceEmailCore(invoiceId);
  if (!delivered.ok) return delivered;

  const db = createSupabaseAdminClient();
  const { data: prev } = await db
    .from("invoices")
    .select("sent_at")
    .eq("id", invoiceId)
    .maybeSingle();

  const sentAt =
    (prev as { sent_at: string | null } | null)?.sent_at ??
    new Date().toISOString();

  // The email is out. Record the status flip — retry a couple of times so a
  // transient DB blip doesn't leave a sent invoice stuck as a draft. If it
  // still fails, flag `delivered` so the cron stops re-sending (no duplicate).
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db
      .from("invoices")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", invoiceId);
    if (!error) {
      pushInvoiceToSage(invoiceId).catch((err) =>
        console.error("[invoice-send] Sage sync on auto-send failed:", err),
      );
      return { ok: true, messageId: delivered.messageId };
    }
    lastErr = error.message;
  }

  return {
    error: `Invoice ${invoiceId} was emailed but its status could not be recorded: ${lastErr}`,
    delivered: true,
  };
}

async function setAutoSendState(
  db: ReturnType<typeof createSupabaseAdminClient>,
  invoiceId: string,
  state: "sent" | "skipped" | "held",
): Promise<void> {
  await (db
    .from("invoices")
    .update({ auto_send_state: state } as never)
    .eq("id", invoiceId) as unknown as Promise<unknown>);
}

/**
 * Sweep drafts whose auto-send window has elapsed and send them. Called by the
 * hourly invoice-auto-send cron. Reads each invoice LIVE at send time, so any
 * edits the owner saved during the review window are included. Send-first
 * ordering: a delivery failure leaves the invoice a draft (marked 'skipped')
 * and alerts the owner rather than silently marking it sent.
 */
export async function runInvoiceAutoSend(): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  held: number;
}> {
  const db = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: due } = (await db
    .from("invoices")
    .select("id, organization_id, amount_cents, number, status, auto_send_state")
    .eq("auto_send_state" as never, "scheduled" as never)
    .lte("auto_send_at" as never, nowIso as never)
    .eq("status", "draft")
    .order("auto_send_at" as never, { ascending: true }) // FIFO if we hit the cap
    .limit(200)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      amount_cents: number;
      number: string | null;
      status: string;
      auto_send_state: string | null;
    }> | null;
  };

  const rows = due ?? [];
  let sent = 0;
  let skipped = 0;
  let held = 0;

  // Which of these orgs STILL have auto-send enabled? An org that disabled it
  // after an invoice was scheduled should not have it sent. (The settings
  // action also stands these down on disable; this is the send-time backstop.)
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const enabledOrgs = new Set<string>();
  if (orgIds.length > 0) {
    const { data: orgRows } = (await db
      .from("organizations")
      .select("id, invoice_auto_send_enabled")
      .in("id", orgIds)) as unknown as {
      data: Array<{ id: string; invoice_auto_send_enabled: boolean }> | null;
    };
    for (const o of orgRows ?? []) {
      if (o.invoice_auto_send_enabled) enabledOrgs.add(o.id);
    }
  }

  for (const inv of rows) {
    // Org turned auto-send off after this was scheduled — stand it down.
    if (!enabledOrgs.has(inv.organization_id)) {
      await setAutoSendState(db, inv.id, "held");
      held++;
      continue;
    }

    // Never auto-send a $0 invoice.
    if ((inv.amount_cents ?? 0) <= 0) {
      await setAutoSendState(db, inv.id, "skipped");
      skipped++;
      continue;
    }

    // Re-check it's still a scheduled draft — the owner may have sent it,
    // held it, or voided it in the window between the query and now.
    const { data: fresh } = (await db
      .from("invoices")
      .select("status, auto_send_state")
      .eq("id", inv.id)
      .maybeSingle()) as unknown as {
      data: { status: string; auto_send_state: string | null } | null;
    };
    if (!fresh || fresh.status !== "draft" || fresh.auto_send_state !== "scheduled") {
      continue;
    }

    const result = await markInvoiceSentSystem(inv.id);
    if (result.ok || result.delivered) {
      // Sent (or emailed-but-record-failed) → mark terminal so it can't
      // re-send, and record a system audit entry for the trail.
      await setAutoSendState(db, inv.id, "sent");
      if (result.delivered) {
        console.error(
          `[invoice-auto-send] invoice ${inv.id} emailed but status not fully recorded — not re-sending: ${result.error}`,
        );
      }
      const { logSystemAuditEvent } = await import("@/lib/audit");
      await logSystemAuditEvent({
        organizationId: inv.organization_id,
        action: "status_change",
        entity: "invoice",
        entity_id: inv.id,
        after: { status: "sent", auto_sent: true },
      });
      sent++;
    } else if (result.permanent) {
      // Won't fix itself (usually a missing client email) → skip + alert owner.
      await setAutoSendState(db, inv.id, "skipped");
      skipped++;
      try {
        const { notify } = await import("@/lib/notify");
        await notify({
          audience: "org-admins",
          organizationId: inv.organization_id,
          type: "invoice_auto_send_failed",
          title: "An invoice couldn't auto-send",
          body: `Invoice ${inv.number ?? inv.id.slice(0, 8)} wasn't sent automatically: ${result.error}`,
          href: `/app/invoices/${inv.id}`,
        });
      } catch (notifyErr) {
        console.error("[invoice-send] auto-send failure notify failed:", notifyErr);
      }
    } else {
      // Transient failure (Resend hiccup, etc.) — leave it 'scheduled' so the
      // next hourly pass retries. No state change, no alert spam.
      console.warn(
        `[invoice-auto-send] transient failure for ${inv.id}, will retry next pass: ${result.error}`,
      );
    }
  }

  return { processed: rows.length, sent, skipped, held };
}
