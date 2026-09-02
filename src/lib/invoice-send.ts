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
import { resolveClientNotify } from "@/lib/notification-gate";
import { sendOrgEmailDetailed, isEmailConfigured } from "@/lib/email";
import { invoiceSentEmail } from "@/lib/email-templates";
import { formatCurrencyCents, FALLBACK_TZ } from "@/lib/format";
import { isValidIanaTz } from "@/lib/org-timezone";
import { nextDayAtHourUtc } from "@/lib/wall-clock";
import {
  computeSendSlot,
  type SendMode,
} from "@/lib/invoice-send-schedule";
import { getOrgCurrency } from "@/lib/org-currency";
import { pushInvoiceToSage } from "@/lib/sage";
import { pushInvoiceToQuickBooks } from "@/lib/quickbooks";

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
      "id, number, status, sent_at, public_token, amount_cents, due_date, organization_id, client:clients ( name, company_name, email )",
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
      ? // due_date is a DATE column — no time of day to place in a zone.
        // UTC keeps "Sep 3" reading as Sep 3 everywhere; an org zone would
        // roll it back to Sep 2.
        new Date(prev.due_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
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
  let pdfAttachment: {
    filename: string;
    content: Buffer;
    contentType: string;
  } | null = null;
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
 *
 * Send slot: {invoice_auto_send_hour}:00 org-local time on the calendar day
 * AFTER the draft is created — a predictable clock time, not a rolling
 * countdown. The morning review digest (7 AM-ish) fires before it, so the
 * owner's rhythm is: digest → fix anything wrong → sends go at the set hour.
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
        "invoice_auto_send_enabled, invoice_auto_send_hour, invoice_auto_send_consolidated, invoice_auto_send_mode, invoice_auto_send_delay_hours, invoice_auto_send_weekday, timezone",
      )
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: {
        invoice_auto_send_enabled: boolean;
        invoice_auto_send_hour: number | null;
        invoice_auto_send_consolidated: boolean;
        invoice_auto_send_mode: string | null;
        invoice_auto_send_delay_hours: number | null;
        invoice_auto_send_weekday: number | null;
        timezone: string | null;
      } | null;
    };

    if (!data || !data.invoice_auto_send_enabled) return;
    if (opts?.consolidated && !data.invoice_auto_send_consolidated) return;

    // Consolidated (billing-cadence) invoices keep the next-day rhythm — the
    // cadence IS their schedule, and holding a monthly invoice for "next
    // Friday" would drift the client's billing date. The org's chosen rhythm
    // governs the per-job drafts: "everyone else".
    const at = computeAutoSendAt(
      new Date(),
      data.timezone,
      data.invoice_auto_send_hour,
      opts?.consolidated
        ? undefined
        : {
            mode: data.invoice_auto_send_mode,
            delayHours: data.invoice_auto_send_delay_hours,
            weekday: data.invoice_auto_send_weekday,
          },
    ).toISOString();

    await (db
      .from("invoices")
      .update({ auto_send_at: at, auto_send_state: "scheduled" } as never)
      .eq("id", invoiceId) as unknown as Promise<unknown>);
  } catch (err) {
    console.error("[invoice-send] scheduleAutoSendIfEnabled failed:", err);
  }
}

/**
 * The send slot, shared by scheduling and the re-arm path.
 *
 * `rhythm` omitted (or absent columns on an org that predates the migration)
 * means the original next-day behaviour, so nothing moves for anyone who
 * hasn't chosen otherwise.
 */
export function computeAutoSendAt(
  from: Date,
  timezone: string | null,
  hour: number | null,
  rhythm?: {
    mode: string | null;
    delayHours: number | null;
    weekday: number | null;
  },
): Date {
  const tz = timezone && isValidIanaTz(timezone) ? timezone : FALLBACK_TZ;
  const h = typeof hour === "number" && hour >= 0 && hour <= 23 ? hour : 17;
  if (!rhythm || !rhythm.mode || rhythm.mode === "next_day") {
    return nextDayAtHourUtc(from, tz, h);
  }
  return computeSendSlot(from, tz, {
    mode: rhythm.mode as SendMode,
    hour: h,
    delayHours: rhythm.delayHours,
    weekday: rhythm.weekday,
  });
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
      pushInvoiceToQuickBooks(invoiceId).catch((err) =>
        console.error(
          "[invoice-send] QuickBooks sync on auto-send failed:",
          err,
        ),
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

/**
 * Deliver an invoice by TEXT with the hosted /i/<token> link. Used by the
 * auto-send cron for text-only clients (where it IS the delivery — status
 * flips to sent) and as the best-effort companion for "Both" clients (where
 * the invoice is already sent and only the nudge goes out).
 *
 * Returns "sent" | "skipped" (opt-in / org SMS / Twilio gates — terminal) |
 * "error" (transient, retry next pass).
 */
async function deliverInvoiceSmsSystem(
  invoiceId: string,
  phone: string,
): Promise<"sent" | "skipped" | "error"> {
  try {
    const db = createSupabaseAdminClient();
    const { data: inv } = (await db
      .from("invoices")
      .select(
        "id, number, status, sent_at, public_token, amount_cents, organization_id",
      )
      .eq("id", invoiceId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        number: string | null;
        status: string;
        sent_at: string | null;
        public_token: string | null;
        amount_cents: number;
        organization_id: string;
      } | null;
    };
    if (!inv) return "skipped";
    if (!inv.public_token) {
      // No hosted link to carry — a text saying "you owe money" with no way
      // to view or pay is worse than the skip note. Owner sends manually.
      console.warn(
        `[invoice-send] SMS delivery for ${invoiceId} skipped — no public token`,
      );
      return "skipped";
    }

    const { data: org } = (await db
      .from("organizations")
      .select("name")
      .eq("id", inv.organization_id)
      .maybeSingle()) as unknown as { data: { name: string } | null };
    const currency = await getOrgCurrency(inv.organization_id);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

    const { sendOrgSms } = await import("@/lib/sms");
    const { composeInvoiceSms } = await import("@/lib/twilio");
    const res = await sendOrgSms(inv.organization_id, {
      to: phone,
      body: composeInvoiceSms({
        orgName: org?.name ?? "Your service provider",
        invoiceNumber: inv.number ?? inv.id.slice(0, 8).toUpperCase(),
        amountFormatted: formatCurrencyCents(inv.amount_cents, currency),
        publicUrl: `${siteUrl}/i/${inv.public_token}`,
      }),
      automationKey: "invoice_auto_send",
    });

    if (!res.ok) return "error";
    if (res.status !== "sent") return "skipped";

    // The text is out. If this was the delivery (draft), flip the status —
    // same retry shape as the email path.
    if (inv.status === "draft") {
      const sentAt = inv.sent_at ?? new Date().toISOString();
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await db
          .from("invoices")
          .update({ status: "sent", sent_at: sentAt })
          .eq("id", invoiceId);
        if (!error) {
          pushInvoiceToSage(invoiceId).catch((err) =>
            console.error(
              "[invoice-send] Sage sync on SMS auto-send failed:",
              err,
            ),
          );
          pushInvoiceToQuickBooks(invoiceId).catch((err) =>
            console.error(
              "[invoice-send] QuickBooks sync on SMS auto-send failed:",
              err,
            ),
          );
          break;
        }
        if (attempt === 2) {
          console.error(
            `[invoice-send] invoice ${invoiceId} texted but status not recorded: ${error.message}`,
          );
        }
      }
    }
    return "sent";
  } catch (err) {
    console.error(
      "[invoice-send] deliverInvoiceSmsSystem failed:",
      invoiceId,
      err,
    );
    return "error";
  }
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
    .select(
      "id, organization_id, client_id, amount_cents, number, status, auto_send_state",
    )
    .eq("auto_send_state" as never, "scheduled" as never)
    .lte("auto_send_at" as never, nowIso as never)
    .eq("status", "draft")
    .order("auto_send_at" as never, { ascending: true }) // FIFO if we hit the cap
    .limit(200)) as unknown as {
    data: Array<{
      id: string;
      organization_id: string;
      client_id: string | null;
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
  // One org-default lookup per org across the whole batch.
  const orgDefaultCache = new Map<
    string,
    import("@/lib/notification-preferences").OrgContactDefault
  >();

  // Which of these orgs STILL have auto-send enabled? An org that disabled it
  // after an invoice was scheduled should not have it sent. (The settings
  // action also stands these down on disable; this is the send-time backstop.)
  //
  // POLICY (audit P1): the automations MASTER SWITCH also gates the SEND.
  // Drafting invoices stays a billing setting (drafts are harmless and the
  // money must still be tracked), but "Turn all off" must stop Sollos from
  // EMAILING clients — an owner who flipped the big switch expects silence.
  const orgIds = [...new Set(rows.map((r) => r.organization_id))];
  const enabledOrgs = new Set<string>();
  if (orgIds.length > 0) {
    const { data: orgRows } = (await db
      .from("organizations")
      .select("id, invoice_auto_send_enabled, automations_enabled")
      .in("id", orgIds)) as unknown as {
      data: Array<{
        id: string;
        invoice_auto_send_enabled: boolean;
        automations_enabled: boolean | null;
      }> | null;
    };
    for (const o of orgRows ?? []) {
      if (o.invoice_auto_send_enabled && o.automations_enabled === true) {
        enabledOrgs.add(o.id);
      }
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

    // Respect the client's notification preference (billing category).
    // Billing is a two-channel category: email, text (opted-in clients with
    // a phone), or both. A do-not-contact client — or one with no usable
    // channel — must not be auto-sent anything. Terminal "skipped" so it
    // isn't retried nightly; the owner can still send it by hand.
    const decision = await resolveClientNotify(db, {
      organizationId: inv.organization_id,
      clientId: inv.client_id,
      category: "billing",
      event: "invoice_send",
      orgDefaultCache,
    });
    const canEmail = decision.email;
    const canSms = decision.sms && Boolean(decision.clientPhone);
    if (!canEmail && !canSms) {
      await setAutoSendState(db, inv.id, "skipped");
      skipped++;
      console.log(
        `[invoice-auto-send] invoice ${inv.id} skipped — client notification preference (${decision.reason})`,
      );
      continue;
    }

    // CLAIM before delivering, not after. The old shape re-checked state and
    // then sent — so two overlapping cron runs (retry, redeploy overlap,
    // manual trigger) could both pass the check and the client got the same
    // invoice twice. The claim flips scheduled→held atomically; whoever
    // loses the race gets zero rows and walks away.
    //
    // 'held' as the claim state is deliberate — it's already in the UI's
    // vocabulary, and it makes the failure direction AT-MOST-ONCE: if we
    // crash mid-send, the draft sits visibly held for the owner instead of
    // silently re-sending next pass. For money email, a held draft beats a
    // duplicate in the client's inbox. The cost: transient failures no
    // longer auto-retry hourly — they wait for a human, which is what the
    // hold/re-arm controls exist for.
    const { data: claimed } = (await db
      .from("invoices")
      .update({ auto_send_state: "held" } as never)
      .eq("id", inv.id)
      .eq("status", "draft")
      .eq("auto_send_state" as never, "scheduled" as never)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };
    if (!claimed || claimed.length === 0) {
      continue;
    }

    // Text-only client: deliver by SMS with the hosted invoice link. The
    // text IS the delivery — status flips to sent exactly like the email
    // path. If SMS can't go out (no opt-in, org SMS off, Twilio disabled),
    // that's terminal-skipped: the owner sends by hand, and the invoice
    // page explains why.
    if (!canEmail && canSms) {
      const smsOutcome = await deliverInvoiceSmsSystem(
        inv.id,
        decision.clientPhone!,
      );
      if (smsOutcome === "sent") {
        await setAutoSendState(db, inv.id, "sent");
        const { logSystemAuditEvent } = await import("@/lib/audit");
        await logSystemAuditEvent({
          organizationId: inv.organization_id,
          action: "status_change",
          entity: "invoice",
          entity_id: inv.id,
          after: { status: "sent", auto_sent: true, channel: "sms" },
        });
        sent++;
      } else if (smsOutcome === "skipped") {
        await setAutoSendState(db, inv.id, "skipped");
        skipped++;
        console.log(
          `[invoice-auto-send] invoice ${inv.id} skipped — SMS channel unavailable (opt-in / org SMS / Twilio)`,
        );
      } else {
        // Transient — leave 'scheduled' for the next hourly pass.
        console.warn(
          `[invoice-auto-send] transient SMS failure for ${inv.id}, will retry next pass`,
        );
      }
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
      // "Both" clients also get the text — a nudge alongside the invoice of
      // record. Best-effort: a failed companion text never un-sends the email.
      if (canSms) {
        try {
          await deliverInvoiceSmsSystem(inv.id, decision.clientPhone!);
        } catch (companionErr) {
          console.error(
            `[invoice-auto-send] companion SMS for ${inv.id} errored:`,
            companionErr,
          );
        }
      }
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
          // Money that did not go out. Email it.
          channels: { email: true },
        });
      } catch (notifyErr) {
        console.error(
          "[invoice-send] auto-send failure notify failed:",
          notifyErr,
        );
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
