import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Prepayments: money a client paid before their job was invoiced.
 *
 * Sollos only invoices a completed job, so "Sylvia paid yesterday for
 * today's clean" had nowhere to go. The payment is recorded on the booking
 * (booking_prepayments) and moves onto the job's invoice the moment one
 * exists — whichever path creates it: the per-job invoice on completion, a
 * hand-made invoice, or a period invoice the job is billed on.
 *
 * Applied LAST by every caller, after tax and line items: the payments
 * trigger computes paid / partially paid from the amount at that moment,
 * and a later amount change would not revisit it.
 */

type Db = ReturnType<typeof createSupabaseAdminClient>;

/** Every job billed on this invoice: its own booking, plus any stamped onto
 *  it by period billing. */
async function bookingsOnInvoice(db: Db, invoiceId: string, bookingId: string | null) {
  const { data: stamped } = (await db
    .from("bookings")
    .select("id")
    .eq("billing_invoice_id" as never, invoiceId as never)) as unknown as {
    data: Array<{ id: string }> | null;
  };
  return [
    ...new Set([...(bookingId ? [bookingId] : []), ...(stamped ?? []).map((b) => b.id)]),
  ];
}

/**
 * Move every unapplied prepayment for the invoice's job(s) onto it as
 * payments. Safe to call more than once: each prepayment is claimed by a
 * guarded update before its payment is written, so a second caller finds
 * nothing left. Returns how many were applied. Never throws.
 */
export async function applyPrepaymentsToInvoice(invoiceId: string): Promise<number> {
  try {
    const db = createSupabaseAdminClient();
    const { data: invoice } = (await db
      .from("invoices")
      .select("id, organization_id, booking_id, amount_cents, voided_at")
      .eq("id", invoiceId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        booking_id: string | null;
        amount_cents: number;
        voided_at: string | null;
      } | null;
    };
    if (!invoice || invoice.voided_at) return 0;

    const bookingIds = await bookingsOnInvoice(db, invoice.id, invoice.booking_id);
    if (bookingIds.length === 0) return 0;

    const { data: prepaid } = (await db
      .from("booking_prepayments" as never)
      .select("id, amount_cents, method, reference, notes, received_at, recorded_by")
      .eq("organization_id" as never, invoice.organization_id as never)
      .in("booking_id" as never, bookingIds as never)
      .is("applied_at" as never, null)
      .order("received_at" as never)) as unknown as {
      data: Array<{
        id: string;
        amount_cents: number;
        method: string;
        reference: string | null;
        notes: string | null;
        received_at: string;
        recorded_by: string | null;
      }> | null;
    };

    let applied = 0;
    for (const p of prepaid ?? []) {
      const now = new Date().toISOString();
      // Claim first: only one caller can flip applied_at from null.
      const { data: claimed } = (await db
        .from("booking_prepayments" as never)
        .update({ applied_at: now, applied_invoice_id: invoice.id } as never)
        .eq("id" as never, p.id as never)
        .is("applied_at" as never, null)
        .select("id")) as unknown as { data: Array<{ id: string }> | null };
      if (!claimed?.length) continue;

      const { data: payment, error } = (await db
        .from("invoice_payments")
        .insert({
          organization_id: invoice.organization_id,
          invoice_id: invoice.id,
          amount_cents: p.amount_cents,
          method: p.method as never,
          reference: p.reference,
          notes: ["Paid before the job", p.notes].filter(Boolean).join(" — "),
          received_at: p.received_at,
          recorded_by: p.recorded_by,
        })
        .select("id")
        .single()) as unknown as {
        data: { id: string } | null;
        error: { message: string } | null;
      };

      if (error || !payment) {
        // Put it back so the next invoice event (or a retry) applies it.
        console.error("[prepayments] payment insert failed:", error?.message);
        await db
          .from("booking_prepayments" as never)
          .update({ applied_at: null, applied_invoice_id: null } as never)
          .eq("id" as never, p.id as never);
        continue;
      }

      await db
        .from("booking_prepayments" as never)
        .update({ applied_payment_id: payment.id } as never)
        .eq("id" as never, p.id as never);
      applied++;

      // The books follow, same as a payment recorded on the invoice.
      const [{ pushInvoicePaymentToSage }, { pushInvoicePaymentToQuickBooks }] =
        await Promise.all([import("@/lib/sage"), import("@/lib/quickbooks")]);
      await Promise.allSettled([
        pushInvoicePaymentToSage(payment.id),
        pushInvoicePaymentToQuickBooks(payment.id),
      ]);
    }

    if (applied > 0) {
      const { data: after } = (await db
        .from("invoices")
        .select("status")
        .eq("id", invoice.id)
        .maybeSingle()) as unknown as { data: { status: string } | null };
      if (after?.status === "paid") {
        const { autoOnInvoicePaid } = await import("@/lib/automations");
        await autoOnInvoicePaid(invoice.id);
      }
    }
    return applied;
  } catch (err) {
    console.error("[prepayments] apply failed for invoice", invoiceId, err);
    return 0;
  }
}

/**
 * The live (not void) invoice a booking is billed on, if any — its own, or a
 * period invoice it was stamped onto. A prepayment recorded after the invoice
 * already exists goes straight onto it.
 */
export async function invoiceForBooking(bookingId: string): Promise<string | null> {
  const db = createSupabaseAdminClient();
  const [{ data: own }, { data: booking }] = await Promise.all([
    db
      .from("invoices")
      .select("id")
      .eq("booking_id", bookingId)
      .is("voided_at", null)
      .limit(1)
      .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>,
    db
      .from("bookings")
      .select("billing_invoice_id" as never)
      .eq("id", bookingId)
      .maybeSingle() as unknown as Promise<{
      data: { billing_invoice_id: string | null } | null;
    }>,
  ]);
  return own?.id ?? booking?.billing_invoice_id ?? null;
}
