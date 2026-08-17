/**
 * Stripe Connect webhook — separate from the billing webhook. Stripe fires
 * these for events on connected accounts (`account.updated`,
 * `payment_intent.succeeded` on a destination charge, etc).
 *
 * Signed with STRIPE_CONNECT_WEBHOOK_SECRET (distinct from the platform's
 * own billing webhook secret).
 */

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import {
  verifyWebhookSignature,
  tryClaimEvent,
  markEventProcessed,
  releaseClaim,
  isStripeConnectEnabled,
} from "@/lib/stripe";
import { applyAccountUpdate } from "@/lib/stripe-connect";
import { sendPayoutNotification } from "@/lib/automations";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record a Stripe card payment as an invoice_payments row (mirrors the
 * Square path) and let the sync_invoice_payment_totals trigger flip the
 * invoice status. This records the ACTUAL amount paid — so an underpayment
 * can't mark an invoice fully paid — and keeps the payments ledger complete.
 *
 * Deduped by (provider, provider_payment_id): checkout.session.completed and
 * payment_intent.succeeded both fire for one payment, and Stripe can retry —
 * only the first insert sticks. The fee (only on the PI event) backfills onto
 * an already-recorded row.
 */
/**
 * Turn a paid gratuity into the rows that say who it's owed to.
 *
 * The money itself has already landed in the org's Stripe balance — a
 * destination charge sweeps the whole net there, cleaner's share included.
 * These rows are the only thing that makes the tip reach a person, so a
 * failure to write them is a failure to pay someone, and it says so loudly in
 * the log rather than returning quietly.
 *
 * Deliberately tolerant about attribution: if nobody can be resolved (jobs
 * with no assignee, or a manual invoice with no bookings behind it) the tip is
 * recorded with a NULL membership rather than dropped. The client paid it; it
 * belongs in the books either way, and the app can ask the owner who it was
 * meant for.
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
    // Cheap pre-check. The partial unique indexes on invoice_tips are the
    // real guard — checkout.session.completed and payment_intent.succeeded
    // race, and whichever loses hits the index rather than double-paying.
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
        `[stripe connect] FAILED to record ${args.tipCents}c tip for invoice ${args.invoiceId}:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(
      `[stripe connect] FAILED to record ${args.tipCents}c tip for invoice ${args.invoiceId}:`,
      err,
    );
  }
}

/** Read the tip out of Stripe event metadata, defensively. */
function tipFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): number {
  const raw = metadata?.tip_cents;
  if (!raw) return 0;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function recordStripeInvoicePayment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: {
    invoiceId: string;
    ownerOrgId: string;
    amountCents: number;
    piId: string | null;
    feeCents: number | null;
    /** Gratuity included in amountCents, from the event metadata. */
    tipCents?: number;
  },
): Promise<void> {
  if (!args.piId || !args.amountCents || args.amountCents <= 0) return;

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
  // Cross-tenant guard — the invoice must belong to the org that owns the
  // connected account this event arrived on.
  if (invoice.organization_id !== args.ownerOrgId) return;
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
    // Already recorded (the paired event/ retry). Backfill the fee if this
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
  // Can't happen today (checkout requires an outstanding balance) but the
  // guard costs nothing and beats inserting a zero-amount payment row.
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

  // If that payment completed the invoice (the ledger trigger flips paid_at),
  // fire the receipt + review-request bundle. Online payers previously never
  // got receipts — autoOnInvoicePaid only ran from the manual mark-paid action
  // (audit P2). Safe against retries/duplicates: it CAS-claims
  // invoices.receipt_sent_at internally, and it's gated by the org toggle +
  // per-client preferences.
  try {
    const { data: after } = (await admin
      .from("invoices")
      .select("paid_at")
      .eq("id", invoice.id)
      .maybeSingle()) as unknown as { data: { paid_at: string | null } | null };
    if (after?.paid_at) {
      const { autoOnInvoicePaid } = await import("@/lib/automations");
      autoOnInvoicePaid(invoice.id).catch((err) =>
        console.error("[stripe-connect] autoOnInvoicePaid failed:", err),
      );
    }
  } catch (err) {
    console.error("[stripe-connect] paid-check failed:", err);
  }
}

export async function POST(req: NextRequest) {
  // 600/min/IP — DoS defense before signature verification.
  const { rateLimitByIp } = await import("@/lib/rate-limit-helpers");
  const limited = await rateLimitByIp(req, "stripe-connect-webhook", 600, 60_000);
  if (limited) return limited;

  if (!isStripeConnectEnabled()) {
    return NextResponse.json(
      { error: "Stripe Connect is not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(
      rawBody,
      signature,
      "STRIPE_CONNECT_WEBHOOK_SECRET",
    );
  } catch (err) {
    console.error("[stripe connect webhook] signature failed", err);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  // Connect events carry the connected account id here.
  const accountId = (event as unknown as { account?: string }).account ?? null;

  // Atomic claim — INSERT on a PK column. The previous SELECT-then-UPSERT
  // pattern had a race where two concurrent Stripe retries could both
  // pass the duplicate check and run the handler twice. With auto-refund
  // and Connect destination charges in the mix, that was a real money
  // bug (double-refund, double-stamp paid).
  const claimed = await tryClaimEvent(event.id, event.type, accountId);
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const admin = createSupabaseAdminClient();

  /**
   * Resolve which org on our platform owns this Stripe account. Used below
   * to enforce that any invoice touched by this event actually belongs to
   * that org — otherwise a malicious Connect-enabled tenant could forge
   * metadata.invoice_id to flip another org's invoices.
   */
  async function ownerOrgForAccount(
    acct: string | null,
  ): Promise<string | null> {
    if (!acct) return null;
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_account_id" as never, acct as never)
      .maybeSingle() as unknown as {
      data: { id: string } | null;
    };
    return data?.id ?? null;
  }

  try {
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        await applyAccountUpdate(account);
        break;
      }

      case "account.application.deauthorized": {
        // The merchant revoked access from their Stripe Dashboard.
        if (accountId) {
          await admin
            .from("organizations")
            .update({
              stripe_account_id: null,
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
              stripe_details_submitted: false,
              stripe_disconnected_at: new Date().toISOString(),
            } as never)
            .eq("stripe_account_id" as never, accountId);
        }
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const invoiceId =
          (session.metadata && session.metadata.invoice_id) || null;
        if (invoiceId && session.payment_status === "paid") {
          // Cross-tenant guard: the invoice must belong to the org that
          // owns this connected account (metadata is attacker-controllable).
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] checkout.session.completed for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await recordStripeInvoicePayment(admin, {
            invoiceId,
            ownerOrgId,
            amountCents: session.amount_total ?? 0,
            piId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id ?? null,
            feeCents: null, // not present on the session; the PI event has it
            tipCents: tipFromMetadata(session.metadata),
          });
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id ?? null;
        if (invoiceId) {
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] payment_intent.succeeded for unknown account ${accountId}, skipping`,
            );
            break;
          }
          await recordStripeInvoicePayment(admin, {
            invoiceId,
            ownerOrgId,
            amountCents: pi.amount_received ?? 0,
            piId: pi.id,
            feeCents: pi.application_fee_amount ?? null,
            tipCents: tipFromMetadata(pi.metadata),
          });
        }
        break;
      }

      case "payout.paid": {
        // Fires on the connected account when Stripe has sent money to
        // the merchant's bank. We notify the owner so they know the
        // deposit is incoming.
        const payout = event.data.object as Stripe.Payout;
        if (accountId) {
          await sendPayoutNotification({
            stripeAccountId: accountId,
            amountCents: payout.amount,
            currency: payout.currency,
            arrivalDateUnix: payout.arrival_date,
            payoutId: payout.id,
          });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        const amountRefunded = charge.amount_refunded ?? 0;
        if (piId && amountRefunded > 0) {
          // PI ids are globally unique (not guessable) so the cross-tenant
          // forgery risk is lower, but we still enforce the org filter
          // defensively in case an attacker has observed a legitimate PI id.
          const ownerOrgId = await ownerOrgForAccount(accountId);
          if (!ownerOrgId) {
            console.warn(
              `[stripe connect] charge.refunded for unknown account ${accountId}, skipping`,
            );
            break;
          }

          // Reconcile through the payments ledger — the single source of truth
          // for invoice status. The previous code filtered invoices by
          // `stripe_payment_intent_id`, a column this checkout path never
          // writes, so every refund matched 0 rows: the invoice stayed "paid"
          // and revenue was never reversed. Instead, find the invoice_payments
          // row we recorded for this PI and stamp refunded_cents; the
          // invoice_payments_sync_totals trigger then recomputes the invoice
          // status ('refunded' when fully refunded, 'partially_paid' otherwise)
          // and reverses the paid total in reports.
          const { data: payment } = (await admin
            .from("invoice_payments" as never)
            .select("id, amount_cents")
            .eq("provider" as never, "stripe" as never)
            .eq("provider_payment_id" as never, piId as never)
            .eq("organization_id" as never, ownerOrgId as never)
            .maybeSingle()) as unknown as {
            data: { id: string; amount_cents: number } | null;
          };

          if (!payment) {
            // Refund for a payment we never recorded — nothing to reverse.
            // Ack (don't 500-loop) and log for manual reconciliation.
            console.warn(
              `[stripe connect] charge.refunded: no recorded payment for PI ${piId} (org ${ownerOrgId}); nothing to reconcile`,
            );
            break;
          }

          // Stripe's amount_refunded is CUMULATIVE, so writing it directly
          // (clamped to the captured amount) is idempotent across multiple
          // partial-refund events and safe on webhook retries.
          const refundedCents = Math.min(amountRefunded, payment.amount_cents);
          const { error: refundErr } = await (admin
            .from("invoice_payments" as never)
            .update({ refunded_cents: refundedCents } as never)
            .eq("id" as never, payment.id as never) as unknown as Promise<{
            error: { message: string } | null;
          }>);
          if (refundErr) {
            console.error(
              "[stripe connect] charge.refunded ledger update failed:",
              refundErr.message,
            );
            return NextResponse.json({ error: "DB update failed" }, { status: 500 });
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[stripe connect webhook] handler error", event.type, err);
    // Release the claim row so Stripe's next retry can re-process. The
    // previous "poison-pilled until human investigates" approach silently
    // lost charge.refunded events on transient DB blips — money goes back
    // to the customer but our DB never marks the invoice refunded.
    await releaseClaim(event.id);
    return NextResponse.json(
      { error: "Handler failed" },
      { status: 500 },
    );
  }

  // Stamp processed_at. If THIS fails, release so retry can run cleanly.
  try {
    await markEventProcessed(event.id);
  } catch (err) {
    console.error("[stripe connect webhook] markEventProcessed failed:", err);
    await releaseClaim(event.id);
    return NextResponse.json(
      { error: "Failed to stamp processed_at" },
      { status: 500 },
    );
  }
  return NextResponse.json({ received: true });
}
