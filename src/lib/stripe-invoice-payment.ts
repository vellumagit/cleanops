import "server-only";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Recording a client's card payment against their invoice — and the tip that
 * rode along with it.
 *
 * THIS LIVES IN A SHARED MODULE BECAUSE IT HAS TO RUN FROM TWO WEBHOOKS, and
 * discovering that cost real money. It was written only into the Connect
 * webhook, on the reasonable-sounding assumption that a payment to a connected
 * account arrives as a connected-account event. It does not. A DESTINATION
 * CHARGE creates its PaymentIntent on the PLATFORM account — that is what
 * makes it a destination charge — so `payment_intent.succeeded` is delivered
 * to the PLATFORM endpoint, which handled only SaaS subscription billing and
 * dropped it on the floor.
 *
 * In production that meant: 21 invoice payments recorded, every one typed in
 * by hand, and not a single card payment ever. RD Professional Corp paid $420
 * by card on 2026-08-12 — Stripe had the money, Sollos showed the invoice as
 * unpaid and chaseable. Worse, the platform handler CLAIMED the event id in
 * the shared dedupe table before ignoring it, so even a correctly-subscribed
 * Connect endpoint would have skipped it as a duplicate.
 *
 * So: one implementation, called from both endpoints, with the tenant check
 * expressed so it works with or without a connected-account id.
 */

export type RecordArgs = {
  invoiceId: string;
  amountCents: number;
  piId: string | null;
  feeCents: number | null;
  /** Gratuity included in amountCents, from the event metadata. */
  tipCents?: number;
  /**
   * The org that owns this money, however the caller established it: resolved
   * from the connected account on the Connect endpoint, or read from the
   * (signature-verified) event metadata on the platform endpoint. The invoice
   * must belong to it or nothing is written.
   */
  expectedOrgId: string | null;
};

/** Read the tip out of Stripe event metadata, defensively. */
export function tipFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): number {
  const raw = metadata?.tip_cents;
  if (!raw) return 0;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The org id the event says this belongs to, if any. */
export function orgFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const raw = metadata?.organization_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Does this event describe a CLIENT invoice payment?
 *
 * The discriminator between the two things that arrive on the platform
 * endpoint: our own SaaS subscription billing (no invoice_id) and a cleaning
 * company's customer paying an invoice (invoice_id present, because
 * createInvoiceCheckoutSession put it there).
 */
export function invoiceFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const raw = metadata?.invoice_id;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Turn a paid gratuity into the rows that say who it's owed to.
 *
 * The money has already landed in the org's Stripe balance — a destination
 * charge sweeps the whole net there, cleaner's share included. These rows are
 * the only thing that makes the tip reach a person, so failing to write them
 * is failing to pay someone, and it says so loudly rather than returning
 * quietly.
 *
 * Tolerant about attribution: if nobody can be resolved (jobs with no
 * assignee, or a manual invoice with no bookings behind it) the tip is
 * recorded with a NULL membership rather than dropped. The client paid it; it
 * belongs in the books either way.
 */
async function recordInvoiceTip(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: {
    invoiceId: string;
    organizationId: string;
    tipCents: number;
    piId: string;
  },
): Promise<void> {
  try {
    // Cheap pre-check. The partial unique indexes on invoice_tips are the real
    // guard — checkout.session.completed and payment_intent.succeeded race, and
    // whichever loses hits the index rather than double-paying.
    const { data: already } = (await admin
      .from("invoice_tips" as never)
      .select("id")
      .eq("provider" as never, "stripe" as never)
      .eq("provider_payment_id" as never, args.piId as never)
      .limit(1)
      .maybeSingle()) as unknown as { data: { id: string } | null };
    if (already) return;

    const { resolveInvoiceTipRecipients, toTipShares } = await import(
      "@/lib/invoice-tip-recipients"
    );
    const { splitTipByMinutes } = await import("@/lib/tip-split");

    const { recipients } = await resolveInvoiceTipRecipients(args.invoiceId);
    const allocations = splitTipByMinutes(
      args.tipCents,
      toTipShares(recipients),
    );

    const rows =
      allocations.length > 0
        ? allocations.map((a) => ({
            organization_id: args.organizationId,
            invoice_id: args.invoiceId,
            membership_id: a.membershipId,
            amount_cents: a.amountCents,
            share_minutes: a.shareMinutes,
            provider: "stripe",
            provider_payment_id: args.piId,
          }))
        : [
            {
              organization_id: args.organizationId,
              invoice_id: args.invoiceId,
              membership_id: null,
              amount_cents: args.tipCents,
              share_minutes: null,
              provider: "stripe",
              provider_payment_id: args.piId,
            },
          ];

    const { error } = (await admin
      .from("invoice_tips" as never)
      .insert(rows as never)) as unknown as {
      error: { message: string; code?: string } | null;
    };

    // 23505 = the race above resolving correctly. Anything else means a tip
    // was paid and nobody is recorded as owed it.
    if (error && error.code !== "23505") {
      console.error(
        `[stripe] FAILED to record ${args.tipCents}c tip for invoice ${args.invoiceId}:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[stripe] FAILED to record ${args.tipCents}c tip for invoice ${args.invoiceId}:`,
      err,
    );
  }
}

/**
 * Record a Stripe card payment as an invoice_payments row (mirrors the Square
 * path) and let the sync_invoice_payment_totals trigger flip the invoice
 * status. Records the ACTUAL amount paid — so an underpayment can't mark an
 * invoice fully paid — and keeps the payments ledger complete.
 *
 * Deduped by (provider, provider_payment_id): checkout.session.completed and
 * payment_intent.succeeded both fire for one payment, and Stripe retries —
 * only the first insert sticks. The fee (only on the PI event) backfills onto
 * an already-recorded row.
 */
export async function recordStripeInvoicePayment(
  args: RecordArgs,
): Promise<void> {
  if (!args.piId || !args.amountCents || args.amountCents <= 0) return;
  const admin = createSupabaseAdminClient();

  // THE TIP IS NOT INVOICE PAYMENT.
  //
  // amount_total (session) and amount_received (PI) are the whole charge, tip
  // included. Booking that straight into invoice_payments would credit the
  // invoice with money that was never owed on it: the balance goes negative,
  // the ledger shows an overpayment that never happened, and every report
  // downstream inherits it. Subtract first, then record what the invoice was
  // actually paid.
  const tipCents = Math.max(0, Math.round(args.tipCents ?? 0));
  const invoiceAmountCents = Math.max(0, args.amountCents - tipCents);

  const { data: invoice } = (await admin
    .from("invoices")
    .select("id, organization_id, voided_at")
    .eq("id", args.invoiceId)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      voided_at: string | null;
    } | null;
  };
  if (!invoice) return;

  // Cross-tenant guard. On the Connect endpoint expectedOrgId is resolved from
  // the connected account; on the platform endpoint it comes from metadata we
  // wrote ourselves, on an event whose signature has already been verified.
  // Either way the invoice must belong to it, so a mismatch writes nothing.
  if (args.expectedOrgId && invoice.organization_id !== args.expectedOrgId) {
    console.warn(
      `[stripe] invoice ${invoice.id} is not in org ${args.expectedOrgId}, skipping`,
    );
    return;
  }
  if (invoice.voided_at) return;

  // Before the payment dedupe, not after. The two Stripe events race, and if
  // the payment row already exists this function returns early — a tip written
  // inside that branch would be lost whenever the OTHER event won.
  if (tipCents > 0) {
    await recordInvoiceTip(admin, {
      invoiceId: invoice.id,
      organizationId: invoice.organization_id,
      tipCents,
      piId: args.piId,
    });
  }

  const { data: dup } = (await admin
    .from("invoice_payments" as never)
    .select("id, provider_fee_cents")
    .eq("provider" as never, "stripe" as never)
    .eq("provider_payment_id" as never, args.piId as never)
    .maybeSingle()) as unknown as {
    data: { id: string; provider_fee_cents: number | null } | null;
  };
  if (dup) {
    // Already recorded (the paired event / a retry). Backfill the fee if this
    // event carried it and the row didn't have it yet.
    if (args.feeCents != null && dup.provider_fee_cents == null) {
      await (admin
        .from("invoice_payments" as never)
        .update({ provider_fee_cents: args.feeCents } as never)
        .eq("id" as never, dup.id as never) as unknown as Promise<unknown>);
    }
    return;
  }

  // A charge that was ENTIRELY tip has nothing to book against the invoice.
  if (invoiceAmountCents <= 0) return;

  await (admin.from("invoice_payments" as never).insert({
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    amount_cents: invoiceAmountCents,
    method: "card",
    reference: "Stripe",
    received_at: new Date().toISOString(),
    provider: "stripe",
    provider_payment_id: args.piId,
    provider_fee_cents: args.feeCents,
  } as never) as unknown as Promise<unknown>);

  console.log(
    `[stripe] recorded ${invoiceAmountCents}c payment${
      tipCents ? ` + ${tipCents}c tip` : ""
    } on invoice ${invoice.id}`,
  );

  // If that payment completed the invoice (the ledger trigger flips paid_at),
  // fire the receipt + review-request bundle. Online payers previously never
  // got receipts. Safe against retries: it CAS-claims invoices.receipt_sent_at
  // internally, and it's gated by the org toggle + per-client preferences.
  try {
    const { data: after } = (await admin
      .from("invoices")
      .select("paid_at")
      .eq("id", invoice.id)
      .maybeSingle()) as unknown as {
      data: { paid_at: string | null } | null;
    };
    if (after?.paid_at) {
      const { autoOnInvoicePaid } = await import("@/lib/automations");
      await autoOnInvoicePaid(invoice.id);
    }
  } catch (err) {
    console.error("[stripe] post-payment automation failed:", err);
  }
}

/**
 * Reconcile a Stripe refund — the sibling of recordStripeInvoicePayment, with
 * the same disease and the same cure. charge.refunded was handled only in the
 * Connect webhook, but a destination charge lives on the PLATFORM account, so
 * its refund event arrives at the platform endpoint — which claimed the event
 * id and fell through `default: break`. The first time Svitlana refunded a
 * card payment from her Stripe dashboard, the invoice would have stayed
 * "paid", revenue never reversed, and any tip still owed to a cleaner for
 * money the client took back. Caught before any real refund existed.
 *
 * TIPS: the payment row is NET of tip; Stripe's amount_refunded is GROSS and
 * cumulative. splitRefund attributes invoice-first (the policy and its why
 * live in tip-split.ts). The tip share claws back UNPAID tip rows — largest
 * first, deleting rows that hit zero because the check constraint forbids
 * zero-amount rows. Tips already paid out are never touched: the business
 * handed that money to a person, and deleting the record of it wouldn't
 * bring it back — it says so loudly in the log instead.
 */
export async function recordStripeRefund(args: {
  piId: string | null;
  /** Stripe's cumulative amount_refunded from the charge object. */
  amountRefundedCents: number;
  expectedOrgId: string | null;
}): Promise<void> {
  if (!args.piId || args.amountRefundedCents <= 0) return;
  const admin = createSupabaseAdminClient();

  const { data: payment } = (await admin
    .from("invoice_payments" as never)
    .select("id, amount_cents, organization_id, invoice_id")
    .eq("provider" as never, "stripe" as never)
    .eq("provider_payment_id" as never, args.piId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      amount_cents: number;
      organization_id: string;
      invoice_id: string;
    } | null;
  };

  if (!payment) {
    // A refund for a payment we never recorded — nothing to reverse. Ack
    // (don't 500-loop Stripe) and log for manual reconciliation.
    console.warn(
      `[stripe] charge.refunded: no recorded payment for PI ${args.piId}; nothing to reconcile`,
    );
    return;
  }
  if (args.expectedOrgId && payment.organization_id !== args.expectedOrgId) {
    console.warn(
      `[stripe] refund PI ${args.piId} is not in org ${args.expectedOrgId}, skipping`,
    );
    return;
  }

  const { splitRefund } = await import("@/lib/tip-split");
  const { invoiceRefundCents, tipRefundCents } = splitRefund(
    args.amountRefundedCents,
    payment.amount_cents,
  );

  // Cumulative write, clamped — idempotent across partial-refund events and
  // webhook retries, and it can never drive net-paid negative.
  const { error: refundErr } = await (admin
    .from("invoice_payments" as never)
    .update({ refunded_cents: invoiceRefundCents } as never)
    .eq("id" as never, payment.id as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (refundErr) {
    // Throw so the webhook 500s and Stripe retries — a dropped refund is
    // money silently wrong in the books.
    throw new Error(`refund ledger update failed: ${refundErr.message}`);
  }
  console.log(
    `[stripe] refund reconciled: ${invoiceRefundCents}c on invoice ${payment.invoice_id}` +
      (tipRefundCents > 0 ? `, ${tipRefundCents}c against the tip` : ""),
  );

  if (tipRefundCents <= 0) return;

  // ── Claw the tip share back from what's still owed ──────────────────────
  const { data: tipRows } = (await admin
    .from("invoice_tips" as never)
    .select("id, amount_cents, paid_out_at")
    .eq("provider" as never, "stripe" as never)
    .eq("provider_payment_id" as never, args.piId as never)) as unknown as {
    data: Array<{
      id: string;
      amount_cents: number;
      paid_out_at: string | null;
    }> | null;
  };

  const unpaid = (tipRows ?? [])
    .filter((t) => !t.paid_out_at)
    .sort((a, b) => b.amount_cents - a.amount_cents);
  const paidOutTotal = (tipRows ?? [])
    .filter((t) => t.paid_out_at)
    .reduce((s, t) => s + t.amount_cents, 0);

  let remaining = tipRefundCents;
  for (const row of unpaid) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, row.amount_cents);
    remaining -= take;
    if (take >= row.amount_cents) {
      await (admin
        .from("invoice_tips" as never)
        .delete()
        .eq("id" as never, row.id as never) as unknown as Promise<unknown>);
    } else {
      await (admin
        .from("invoice_tips" as never)
        .update({ amount_cents: row.amount_cents - take } as never)
        .eq("id" as never, row.id as never) as unknown as Promise<unknown>);
    }
  }

  if (remaining > 0) {
    console.warn(
      `[stripe] refund clawed back ${tipRefundCents - remaining}c of tip on PI ${args.piId}; ` +
        `${remaining}c could not be recovered — ${paidOutTotal}c was already paid out to the cleaner. ` +
        `The business absorbed it.`,
    );
  }
}
