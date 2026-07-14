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
async function recordStripeInvoicePayment(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: {
    invoiceId: string;
    ownerOrgId: string;
    amountCents: number;
    piId: string | null;
    feeCents: number | null;
  },
): Promise<void> {
  if (!args.piId || !args.amountCents || args.amountCents <= 0) return;

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

  await (admin.from("invoice_payments" as never).insert({
    organization_id: invoice.organization_id,
    invoice_id: invoice.id,
    amount_cents: args.amountCents,
    method: "card",
    reference: "Stripe",
    received_at: new Date().toISOString(),
    provider: "stripe",
    provider_payment_id: args.piId,
    provider_fee_cents: args.feeCents,
  } as never) as unknown as Promise<unknown>);
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
