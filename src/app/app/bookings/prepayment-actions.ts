"use server";

import { revalidatePath } from "next/cache";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { getOrgTimezone } from "@/lib/org-timezone";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents } from "@/lib/format";
import { localInputToUtcIso } from "@/lib/validators/common";
import { InvoicePaymentSchema, PAYMENT_METHODS } from "@/lib/validators/invoice-payment";
import {
  applyPrepaymentsToInvoice,
  invoiceBalanceFor,
  invoiceForBooking,
  prepaymentRefusal,
} from "@/lib/booking-prepayments";

export type PrepaymentState = ActionState<
  "amount_dollars" | "method" | "reference" | "received_at" | "notes"
> & { ok?: boolean; appliedTo?: string | null };

/**
 * Record money a client paid before their job was invoiced. Sits on the
 * booking until the job's invoice exists, then becomes a payment on it — or
 * goes straight on, if the invoice already exists. See
 * lib/booking-prepayments.ts. Same rules as recording an invoice payment:
 * owner/admin only, no card numbers in the reference or notes.
 */
export async function recordBookingPrepaymentAction(
  bookingId: string,
  _prev: PrepaymentState,
  formData: FormData,
): Promise<PrepaymentState> {
  const raw = {
    amount_dollars: String(formData.get("amount_dollars") ?? ""),
    method: String(formData.get("method") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    received_at: String(formData.get("received_at") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  const parsed = parseForm(InvoicePaymentSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return {
      errors: { _form: "Only owners and admins can record payments." },
      values: raw,
    };
  }

  const { data: booking } = (await supabase
    .from("bookings")
    .select("id, organization_id, client_id, status")
    .eq("id", bookingId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      client_id: string | null;
      status: string;
    } | null;
  };
  if (!booking) return { errors: { _form: "Job not found." }, values: raw };
  if (booking.status === "cancelled") {
    return {
      errors: {
        _form: "This job is cancelled. Record the payment on the client's next job instead.",
      },
      values: raw,
    };
  }

  // Already invoiced? This money goes straight onto that invoice, so it has to
  // fit. See prepaymentRefusal.
  const existingInvoiceId = await invoiceForBooking(booking.id);
  if (existingInvoiceId) {
    const balance = await invoiceBalanceFor(existingInvoiceId);
    if (!balance) {
      return {
        errors: { _form: "Couldn't check this job's invoice, so nothing was recorded. Try again." },
        values: raw,
      };
    }
    const currency = await getOrgCurrency(membership.organization_id);
    const refusal = prepaymentRefusal(balance, parsed.data.amount_dollars, (c) =>
      formatCurrencyCents(c, currency),
    );
    if (refusal) return { errors: { _form: refusal }, values: raw };
  }

  const tz = await getOrgTimezone(membership.organization_id);
  const receivedAt = localInputToUtcIso(
    // A bare date means "that day" — noon keeps it on that date in any zone.
    /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.received_at)
      ? `${parsed.data.received_at}T12:00`
      : parsed.data.received_at,
    tz,
  );

  const { data: inserted, error } = (await supabase
    .from("booking_prepayments" as never)
    .insert({
      organization_id: membership.organization_id,
      booking_id: booking.id,
      client_id: booking.client_id,
      amount_cents: parsed.data.amount_dollars, // schema converts to cents
      method: parsed.data.method as (typeof PAYMENT_METHODS)[number],
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      received_at: receivedAt,
      recorded_by: membership.id,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Couldn't save the payment." }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "booking",
    entity_id: booking.id,
    after: {
      prepayment_id: inserted.id,
      amount_cents: parsed.data.amount_dollars,
      method: parsed.data.method,
    },
  });

  // Invoice already there (a period invoice, or one made by hand)? Then it
  // goes straight on.
  const invoiceId = await invoiceForBooking(booking.id);
  if (invoiceId) await applyPrepaymentsToInvoice(invoiceId);

  revalidatePath(`/app/bookings/${booking.id}`);
  if (invoiceId) revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
  return { ok: true, appliedTo: invoiceId };
}

/**
 * Remove a prepayment recorded by mistake. Only while it's still on the
 * booking — once it's on an invoice it's an invoice payment, and that's
 * where it gets edited or removed.
 */
export async function removeBookingPrepaymentAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const bookingId = String(formData.get("booking_id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;

  const { data: removed } = (await supabase
    .from("booking_prepayments" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .is("applied_at" as never, null)
    .select("id, amount_cents")) as unknown as {
    data: Array<{ id: string; amount_cents: number }> | null;
  };

  if (removed?.length) {
    await logAuditEvent({
      membership,
      action: "delete",
      entity: "booking",
      entity_id: bookingId || id,
      before: { prepayment_id: id, amount_cents: removed[0].amount_cents },
    });
  }
  if (bookingId) revalidatePath(`/app/bookings/${bookingId}`);
}
