import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tip that didn't come through a card.
 *
 * Tipping shipped on the Stripe path first, which covers the way this client's
 * customers pay almost never: 21 of their 23 recorded payments are bank
 * transfers, and one of the two card payments was a test. E-transfer and cash
 * are how tips will actually arrive, so they need somewhere to go.
 *
 * WHO IS HOLDING THE MONEY is the distinction that matters, and it is easy to
 * collapse by accident:
 *
 *   held    The business received it — a client e-transferred $160 against a
 *           $140 invoice, or handed cash to the office. The cleaner has not
 *           been paid, so this is a LIABILITY and belongs in "Tips to pass on".
 *
 *   direct  The client put cash in the cleaner's hand. The money never touched
 *           the business and nobody owes anybody anything. Recording this as
 *           outstanding would invent a debt and invite paying it twice.
 *
 * Both are worth recording — "what did Olha make in tips this month" is a fair
 * question — so a direct tip is written with paid_out_at already stamped. It
 * appears in history and in per-person totals, and never in what's owed.
 */

export type TipCustody = "held" | "direct";

export async function recordManualTip(
  supabase: SupabaseClient,
  args: {
    invoiceId: string;
    organizationId: string;
    tipCents: number;
    custody: TipCustody;
    /** Payment method it arrived with, e.g. "bank_transfer" or "cash". */
    method: string;
    /** The invoice_payments row it rode in on, when there is one. */
    paymentId: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(args.tipCents) || args.tipCents <= 0) {
    return { ok: true }; // no tip is not an error
  }

  try {
    const { resolveInvoiceTipRecipients, toTipShares } = await import(
      "@/lib/invoice-tip-recipients"
    );
    const { splitTipByMinutes } = await import("@/lib/tip-split");

    const { recipients } = await resolveInvoiceTipRecipients(args.invoiceId);
    const allocations = splitTipByMinutes(
      args.tipCents,
      toTipShares(recipients),
    );

    // Same largest-remainder split a card tip gets, for the same reason: the
    // allocations must sum to exactly what was given, whatever the money
    // travelled in.
    const settledAt =
      args.custody === "direct" ? new Date().toISOString() : null;

    const base = {
      organization_id: args.organizationId,
      invoice_id: args.invoiceId,
      provider: args.method,
      // No provider_payment_id: that column is Stripe's idempotency key, and
      // the partial unique indexes only bite when it is non-null. A manual tip
      // is entered deliberately by a person, so there is no retry to dedupe
      // against — and reusing the payment id here would make a legitimate
      // second tip on the same invoice fail.
      provider_payment_id: null,
      paid_out_at: settledAt,
    };

    const rows =
      allocations.length > 0
        ? allocations.map((a) => ({
            ...base,
            membership_id: a.membershipId,
            amount_cents: a.amountCents,
            share_minutes: a.shareMinutes,
          }))
        : [
            {
              ...base,
              membership_id: null,
              amount_cents: args.tipCents,
              share_minutes: null,
            },
          ];

    const { error } = (await supabase
      .from("invoice_tips")
      .insert(rows as never)) as unknown as {
      error: { message: string } | null;
    };
    if (error) {
      console.error("[tips] manual tip insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.error("[tips] manual tip failed:", err);
    return { ok: false, error: "Could not record the tip." };
  }
}
