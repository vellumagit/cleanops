"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { netPaidCents } from "@/lib/invoice-balance";
import { InvoiceSchema } from "@/lib/validators/invoices";
import { autoInvoiceOnJobComplete } from "@/lib/automations";
import {
  InvoicePaymentSchema,
  type PAYMENT_METHODS,
} from "@/lib/validators/invoice-payment";
import { localInputToUtcIso, parseDollarsToCents } from "@/lib/validators/common";
import { normalizeTipCents } from "@/lib/tip-split";
import { generateClaimToken } from "@/lib/claim-token";
import { autoOnInvoicePaid } from "@/lib/automations";
import { canCreateData } from "@/lib/subscription";
import { redirectAfterSetup } from "@/lib/setup-return";
import { redirectBack } from "@/lib/return-to";
import { computeTax, parseTaxRate } from "@/lib/invoice-tax";
import { pushInvoiceToSage } from "@/lib/sage";
import { pushInvoiceToQuickBooks } from "@/lib/quickbooks";
import {
  deliverInvoiceEmailCore,
  type SendInvoiceState,
} from "@/lib/invoice-send";

type Field = keyof typeof InvoiceSchema.shape;
export type InvoiceFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    booking_id: String(formData.get("booking_id") ?? ""),
    status: String(formData.get("status") ?? "draft"),
    subtotal_cents: String(formData.get("subtotal_cents") ?? ""),
    due_date: String(formData.get("due_date") ?? ""),
    tax_rate_bps: String(formData.get("tax_rate_bps") ?? ""),
    tax_label: String(formData.get("tax_label") ?? ""),
  };
}

function maybeStamp(
  status: string,
  prev?: { sent_at?: string | null; paid_at?: string | null },
) {
  const now = new Date().toISOString();
  return {
    sent_at:
      status === "sent" || status === "paid" || status === "overdue"
        ? prev?.sent_at ?? now
        : null,
    paid_at: status === "paid" ? prev?.paid_at ?? now : null,
  };
}

/**
 * Translate an invoice write failure into something a human can act on.
 * The one that bit in production: invoices_booking_uidx (one LIVE invoice
 * per booking) surfacing verbatim as "duplicate key value violates unique
 * constraint" — correct rule, hostile sentence.
 */
async function friendlyInvoiceDbError(
  supabase: Awaited<ReturnType<typeof getActionContext>>["supabase"],
  error: { message: string } | null,
  bookingId: string | null | undefined,
): Promise<string> {
  const message = error?.message ?? "Save failed";
  if (!message.includes("invoices_booking_uidx")) return message;

  let label = "another invoice";
  if (bookingId) {
    const { data: existing } = (await supabase
      .from("invoices")
      .select("number")
      .eq("booking_id", bookingId)
      .is("voided_at" as never, null as never)
      .limit(1)
      .maybeSingle()) as unknown as { data: { number: number | null } | null };
    if (existing?.number != null) {
      label = `invoice INV-${String(existing.number).padStart(3, "0")}`;
    }
  }
  return `That booking is already billed by ${label} — a booking can only carry one live invoice. Open that invoice instead, or void it first if this is a correction.`;
}

export async function createInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InvoiceSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to create new invoices." }, values: raw };
  }

  const stamps = maybeStamp(parsed.data.status);
  // Tax is applied on top of the subtotal; amount_cents (grand total)
  // is subtotal + tax so every existing query that reads amount_cents
  // as "what the client owes" keeps its semantics.
  const tax = computeTax(parsed.data.subtotal_cents, {
    rateBps: parsed.data.tax_rate_bps,
  });
  const { data: inserted, error } = await (supabase
    .from("invoices")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      booking_id: parsed.data.booking_id,
      status: parsed.data.status,
      amount_cents: tax.totalCents,
      tax_rate_bps: tax.rateBps,
      tax_amount_cents: tax.taxAmountCents,
      tax_label: tax.rateBps ? parsed.data.tax_label : null,
      due_date: parsed.data.due_date,
      sent_at: stamps.sent_at,
      paid_at: stamps.paid_at,
    } as never)
    .select("id")
    .single() as unknown as Promise<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>);

  if (error || !inserted) {
    return {
      errors: {
        _form: await friendlyInvoiceDbError(
          supabase,
          error,
          parsed.data.booking_id,
        ),
      },
      values: raw,
    };
  }

  // Stamp the booking as billed. Without this, a biweekly/monthly client's
  // booking manually invoiced here was invoiced AGAIN by the consolidated
  // billing-cycle cron, which only skips bookings with billing_invoice_id set
  // (audit M1d). Guarded on still-null so we never overwrite an existing link.
  if (parsed.data.booking_id) {
    const { error: stampErr } = await supabase
      .from("bookings")
      .update({ billing_invoice_id: inserted.id } as never)
      .eq("id", parsed.data.booking_id)
      .eq("organization_id", membership.organization_id)
      .is("billing_invoice_id" as never, null as never);
    if (stampErr) {
      console.error(
        `[invoices] billing_invoice_id stamp failed (invoice still created):`,
        stampErr.message,
      );
    }
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "invoice",
    entity_id: inserted.id,
    after: {
      status: parsed.data.status,
      amount_cents: tax.totalCents,
      tax_amount_cents: tax.taxAmountCents,
      client_id: parsed.data.client_id,
    },
  });

  revalidatePath("/app/invoices");
  revalidatePath("/app");
  redirectAfterSetup(formData, `/app/invoices/${inserted.id}/edit`);
}

export async function updateInvoiceAction(
  id: string,
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InvoiceSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { data: prev } = await supabase
    .from("invoices")
    .select(
      "organization_id, status, amount_cents, sent_at, paid_at, client_id, tax_rate_bps, tax_label",
    )
    .eq("id", id)
    .maybeSingle();

  // Void and refunded invoices are closed records, and this form predates
  // both states. Without the gate, editing a void invoice silently un-voids
  // it (the form's status just gets written), and editing a refunded one
  // recomputed it straight back to "paid" from its gross payment rows.
  if (prev?.status === "void" || prev?.status === "refunded") {
    return {
      errors: {
        _form:
          prev.status === "void"
            ? "This invoice is void. A voided invoice is a closed record — create a new invoice instead."
            : "This invoice was refunded. That's a closed record of money that moved both ways — create a new invoice instead.",
      },
      values: raw,
    };
  }

  const tax = computeTax(parsed.data.subtotal_cents, {
    rateBps: parsed.data.tax_rate_bps,
  });

  // ONE save for the whole invoice: when the form carries line items,
  // reconcile them right here — rows synced, subtotal + tax recomputed —
  // so fields, items, and totals commit together. (They used to be two
  // forms with two Save buttons; the second one is gone.)
  const managedElsewhere = formData.get("totals_managed_elsewhere") === "1";
  let itemsMoneyFields: Record<string, unknown> | null = null;
  let itemsCount: number | null = null;
  let effectiveTotal = managedElsewhere
    ? prev?.amount_cents ?? 0
    : tax.totalCents;

  if (managedElsewhere && formData.get("line_items_json") != null && prev) {
    const { reconcileInvoiceLineItems } = await import(
      "@/lib/invoice-line-items"
    );
    const result = await reconcileInvoiceLineItems(
      supabase,
      {
        id,
        organization_id: (prev as { organization_id?: string })
          .organization_id as string,
        tax_rate_bps:
          (prev as { tax_rate_bps?: number | null }).tax_rate_bps ?? null,
        tax_label: (prev as { tax_label?: string | null }).tax_label ?? null,
      },
      formData,
    );
    if (!result.ok) {
      return { errors: { _form: result.error }, values: raw };
    }
    itemsMoneyFields = {
      amount_cents: result.totalCents,
      tax_rate_bps: result.taxRateBps,
      tax_amount_cents: result.taxAmountCents,
      tax_label: result.taxLabel,
    };
    itemsCount = result.itemCount;
    effectiveTotal = result.totalCents;
  }

  // Respect the payment ledger: if the invoice has recorded payments, the
  // edit form can't revert it below its paid state (which would null
  // paid_at and re-arm overdue reminders despite real money received).
  // Recompute status from what's actually been paid vs the (possibly
  // edited) total. With NO payments, the form's status stands — so manual
  // "mark paid" for a cash invoice still works.
  const { data: payRows } = (await supabase
    .from("invoice_payments")
    .select("amount_cents, refunded_cents")
    .eq("invoice_id", id)) as unknown as {
    data: Array<{ amount_cents: number; refunded_cents: number | null }> | null;
  };
  // NET of refunds — a $100 payment with $40 refunded holds $60 against
  // this invoice, so an edit must land it on partially_paid, not paid.
  const totalPaid = netPaidCents(payRows ?? []);

  // Widen to the DB invoice_status (the form enum lacks partially_paid).
  let effectiveStatus: string = parsed.data.status;
  let stamps: { sent_at: string | null; paid_at: string | null };
  if (totalPaid > 0) {
    const now = new Date().toISOString();
    effectiveStatus = totalPaid >= effectiveTotal ? "paid" : "partially_paid";
    stamps = {
      sent_at: prev?.sent_at ?? now, // a (part-)paid invoice was sent
      paid_at: effectiveStatus === "paid" ? prev?.paid_at ?? now : null,
    };
  } else {
    stamps = maybeStamp(parsed.data.status, prev ?? undefined);
  }

  // Items mode with a payload: money comes from the reconciled items.
  // Items mode without one (a stale client that predates the merge):
  // leave money untouched. Otherwise this form computes the total.
  const moneyFields = itemsMoneyFields
    ? itemsMoneyFields
    : managedElsewhere
      ? {}
      : {
          amount_cents: tax.totalCents,
          tax_rate_bps: tax.rateBps,
          tax_amount_cents: tax.taxAmountCents,
          tax_label: tax.rateBps ? parsed.data.tax_label : null,
        };

  const { error } = await (supabase
    .from("invoices")
    .update({
      client_id: parsed.data.client_id,
      booking_id: parsed.data.booking_id,
      status: effectiveStatus,
      ...moneyFields,
      due_date: parsed.data.due_date,
      sent_at: stamps.sent_at,
      paid_at: stamps.paid_at,
    } as never)
    .eq("id", id) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) {
    // Re-pointing an invoice at a booking another live invoice already
    // bills hits the same unique index the create path does.
    return {
      errors: {
        _form: await friendlyInvoiceDbError(
          supabase,
          error,
          parsed.data.booking_id,
        ),
      },
      values: raw,
    };
  }

  // Promote a status change to its own audit action so the viewer can
  // distinguish a "mark paid" from a generic update.
  const becamePaid = prev?.status !== "paid" && effectiveStatus === "paid";
  await logAuditEvent({
    membership,
    action: becamePaid
      ? "mark_paid"
      : prev?.status !== effectiveStatus
        ? "status_change"
        : "update",
    entity: "invoice",
    entity_id: id,
    before: prev ?? null,
    after: {
      status: effectiveStatus,
      amount_cents: effectiveTotal,
      tax_amount_cents: managedElsewhere ? undefined : tax.taxAmountCents,
      line_items_count: itemsCount ?? undefined,
      paid_at: stamps.paid_at,
    },
  });

  revalidatePath("/app/invoices");
  revalidatePath(`/app/invoices/${id}`);
  revalidatePath(`/app/invoices/${id}/edit`);
  revalidatePath("/app");
  // Back where they came from — a client's page, a filtered list — and
  // failing that, the invoice they just edited. It used to land on the
  // unfiltered list of every invoice in the business, so editing one
  // invoice for one client threw away the context you were working in and
  // left you filtering your way back to it.
  redirectBack(formData, `/app/invoices/${id}`);
}

// -----------------------------------------------------------------------------
// Phase 12 — manual payment recording, send, void
// -----------------------------------------------------------------------------

type PaymentField = keyof typeof InvoicePaymentSchema.shape;
export type InvoicePaymentFormState = ActionState<PaymentField>;

/**
 * Record a manual payment against an invoice. The DB trigger
 * `invoice_payments_sync_totals` auto-updates the parent invoice's status
 * and paid_at based on the new sum of payments — we don't touch those
 * columns here.
 */
export async function recordInvoicePaymentAction(
  invoiceId: string,
  _prev: InvoicePaymentFormState,
  formData: FormData,
): Promise<InvoicePaymentFormState> {
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

  // Financial operation — owner/admin only. Managers handle scheduling
  // and crew ops, not money-in/money-out.
  if (!["owner", "admin"].includes(membership.role)) {
    return {
      errors: { _form: "Only owners and admins can record payments." },
      values: raw,
    };
  }

  // Guard: invoice must belong to the caller's org. RLS will enforce this
  // anyway, but fetching first lets us return a clean error.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, organization_id, amount_cents, voided_at, payments:invoice_payments ( amount_cents, refunded_cents )")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr || !invoice) {
    return { errors: { _form: invErr?.message ?? "Invoice not found" }, values: raw };
  }
  if (invoice.voided_at) {
    return {
      errors: { _form: "This invoice has been voided and cannot accept payments." },
      values: raw,
    };
  }

  // Double-submit guard. A double-click or a browser retry posts the SAME
  // form — same invoice, amount, method, and (crucially) the same typed
  // received_at down to the second — and used to record the payment twice.
  // An exact quadruple match means "this exact recording already happened";
  // a genuine second payment of the same amount arrives with its own time.
  const receivedAtIso = localInputToUtcIso(parsed.data.received_at);
  {
    const { data: identical } = await supabase
      .from("invoice_payments")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("amount_cents", parsed.data.amount_dollars)
      .eq("method", parsed.data.method)
      .eq("received_at", receivedAtIso)
      .limit(1)
      .maybeSingle();
    if (identical) {
      return {
        errors: {
          _form:
            "This exact payment is already recorded (same amount, method, and time) — likely a double-click. If the client truly paid twice, change the received time to when the second payment arrived.",
        },
        values: raw,
      };
    }
  }

  const { data: inserted, error } = await supabase
    .from("invoice_payments")
    .insert({
      organization_id: invoice.organization_id,
      invoice_id: invoice.id,
      amount_cents: parsed.data.amount_dollars, // schema already converted to cents
      method: parsed.data.method as (typeof PAYMENT_METHODS)[number],
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      received_at: receivedAtIso,
      recorded_by: membership.id,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };
  }

  // A tip that arrived alongside this payment — an e-transfer for more than
  // the invoice, or cash. Deliberately NOT part of amount_cents: the payment
  // row records what the invoice was paid, exactly as on the card path, so a
  // tip can never drive the balance negative or read as an overpayment.
  const tipCents = normalizeTipCents(formData.get("tip_cents"));
  let tipError: string | undefined;
  if (tipCents) {
    const custody =
      String(formData.get("tip_custody") ?? "held") === "direct"
        ? "direct"
        : "held";
    const { recordManualTip } = await import("@/lib/manual-tip");
    const res = await recordManualTip(supabase, {
      invoiceId: invoice.id,
      organizationId: invoice.organization_id,
      tipCents,
      custody,
      method: parsed.data.method,
      paymentId: inserted.id,
    });
    // The payment is already saved and correct. A failed tip must not
    // masquerade as a failed payment, so this surfaces separately.
    if (!res.ok) {
      tipError = `The payment saved, but the tip did not: ${
        res.error ?? "unknown error"
      }. Record it again once that is fixed.`;
    }
  }

  await logAuditEvent({
    membership,
    action: "mark_paid",
    entity: "invoice",
    entity_id: invoice.id,
    after: {
      payment_id: inserted.id,
      amount_cents: parsed.data.amount_dollars,
      method: parsed.data.method,
      reference: parsed.data.reference ?? null,
      tip_cents: tipCents ?? 0,
    },
  });

  revalidatePath(`/app/invoices/${invoice.id}`);
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  revalidatePath("/app/payroll");

  // Check if the invoice is now fully paid (trigger recomputes status async,
  // so we check the amounts ourselves)
  const totalPaid =
    netPaidCents(invoice.payments) + parsed.data.amount_dollars; // amount_dollars is actually cents (schema-transformed)
  if (totalPaid >= invoice.amount_cents) {
    autoOnInvoicePaid(invoice.id);
  }

  return tipError ? { errors: { _form: tipError } } : {};
}

/**
 * Update a manually-recorded payment. Useful when the owner typed the wrong
 * amount or recorded it on the wrong date. Processor payments (Stripe,
 * etc.) can't be edited this way — they have to come back through a
 * refund/adjustment webhook or they'll desync with the processor.
 */
export type RefundPaymentState = {
  error?: string;
  ok?: boolean;
};

/**
 * Refund a card payment — the button a destination-charge architecture owes
 * its merchants. The charge lives on the PLATFORM's Stripe account, so no
 * Sollos owner can refund their own client from their own dashboard; this is
 * the only door. Money OUT, so owner/admin, same as recording money in.
 *
 * The ledger is deliberately NOT written here: issuing the refund makes
 * Stripe emit charge.refunded, and the webhook is the single writer that
 * reconciles the payment row and claws back any unpaid tip — the same path a
 * platform-dashboard refund takes, so both roads produce identical books.
 */
export async function refundSquarePaymentAction(
  _prev: RefundPaymentState,
  formData: FormData,
): Promise<RefundPaymentState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can issue refunds." };
  }

  const paymentId = String(formData.get("payment_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!paymentId || !invoiceId) return { error: "Missing payment." };

  const full = String(formData.get("mode") ?? "") === "full";
  let amountCents: number | null = null;
  if (!full) {
    const parsed = parseDollarsToCents(
      String(formData.get("amount_dollars") ?? ""),
    );
    if (parsed === null || parsed <= 0) {
      return { error: "Enter an amount to refund." };
    }
    amountCents = parsed;
  }

  const { issueSquareRefund } = await import("@/lib/square-refunds");
  const result = await issueSquareRefund({
    organizationId: membership.organization_id,
    paymentId,
    amountCents,
    requestedBy: membership.id,
  });
  if (!result.ok) return { error: result.error };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "invoice",
    entity_id: invoiceId,
    after: {
      refund_issued_cents: result.refundedCents,
      full_refund: result.full,
      payment_id: paymentId,
      provider: "square",
    },
  });

  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
  return { ok: true };
}

export async function refundStripePaymentAction(
  _prev: RefundPaymentState,
  formData: FormData,
): Promise<RefundPaymentState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can issue refunds." };
  }

  const paymentId = String(formData.get("payment_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!paymentId || !invoiceId) return { error: "Missing payment." };

  const full = String(formData.get("mode") ?? "") === "full";
  let amountCents: number | null = null;
  if (!full) {
    const parsed = parseDollarsToCents(String(formData.get("amount_dollars") ?? ""));
    if (parsed === null || parsed <= 0) {
      return { error: "Enter an amount to refund." };
    }
    amountCents = parsed;
  }

  const { issueStripeRefund } = await import("@/lib/stripe-refunds");
  const result = await issueStripeRefund({
    organizationId: membership.organization_id,
    paymentId,
    amountCents,
    requestedBy: membership.id,
  });
  if (!result.ok) return { error: result.error };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "invoice",
    entity_id: invoiceId,
    after: {
      refund_issued_cents: result.refundedCents,
      full_refund: result.full,
      payment_id: paymentId,
    },
  });

  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
  revalidatePath("/app/payroll");
  return { ok: true };
}

export async function updateInvoicePaymentAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const paymentId = String(formData.get("payment_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!paymentId || !invoiceId)
    return { ok: false, error: "Missing payment or invoice id." };

  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can edit payments." };
  }

  const { data: prev } = await supabase
    .from("invoice_payments")
    .select(
      "id, invoice_id, amount_cents, method, reference, notes, received_at, provider",
    )
    .eq("id", paymentId)
    .maybeSingle();

  if (!prev) return { ok: false, error: "Payment not found." };
  // Reject if the caller-supplied invoiceId doesn't match the payment's actual
  // invoice — prevents a crafted POST from polluting the audit log with a
  // foreign invoice ID while mutating their own payment row.
  if (prev.invoice_id !== invoiceId) {
    return { ok: false, error: "Payment/invoice mismatch." };
  }
  if (prev.provider) {
    return {
      ok: false,
      error:
        "This payment came from a processor and can't be edited manually. Issue a refund/adjustment via the processor instead.",
    };
  }

  const raw = {
    amount_dollars: String(formData.get("amount_dollars") ?? ""),
    method: String(formData.get("method") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    received_at: String(formData.get("received_at") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  const parsed = parseForm(InvoicePaymentSchema, raw);
  if (!parsed.ok) {
    const firstErr =
      parsed.errors._form ??
      Object.values(parsed.errors).find((v) => typeof v === "string");
    return { ok: false, error: firstErr ?? "Invalid input." };
  }

  const { error } = await supabase
    .from("invoice_payments")
    .update({
      amount_cents: parsed.data.amount_dollars, // schema already converted to cents
      method: parsed.data.method as (typeof PAYMENT_METHODS)[number],
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      received_at: localInputToUtcIso(parsed.data.received_at),
    })
    .eq("id", paymentId);

  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "invoice",
    entity_id: invoiceId,
    before: prev ?? null,
    after: {
      payment_id: paymentId,
      amount_cents: parsed.data.amount_dollars,
      method: parsed.data.method,
      reference: parsed.data.reference ?? null,
    },
  });

  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  return { ok: true };
}

/**
 * Delete a manual payment row. The trigger will recompute invoice totals.
 */
export async function deleteInvoicePaymentAction(formData: FormData) {
  const paymentId = String(formData.get("payment_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!paymentId || !invoiceId) return;

  const { membership, supabase } = await getActionContext();

  // Reversing a payment is financial — owner/admin only.
  if (!["owner", "admin"].includes(membership.role)) {
    throw new Error("Only owners and admins can delete payments.");
  }

  const { data: prev } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, amount_cents, method, reference, provider")
    .eq("id", paymentId)
    .maybeSingle();

  if (!prev) return;
  // Guard against a crafted POST supplying a foreign invoiceId to poison the
  // audit log while deleting their own payment row.
  if (prev.invoice_id !== invoiceId) {
    throw new Error("Payment/invoice mismatch.");
  }
  // Never let a user delete a processor-originated payment manually —
  // that has to come back through a refund webhook or it'll desync.
  if (prev.provider) {
    throw new Error(
      "Processor payments can't be removed manually. Issue a refund through the processor instead.",
    );
  }

  // A tip recorded alongside this payment goes with it.
  //
  // The only reason to delete a payment is that it was entered wrong, and the
  // fix is to re-record it — which records the tip again. Leaving the first
  // one behind means $20 given and $40 owed to the cleaner. Deleted BEFORE the
  // payment so a failure here can't strand a tip whose payment is already
  // gone; a tip that outlives its payment is money we'd pay out twice.
  // .select() so the delete REPORTS what it removed. This exact statement
  // shipped fire-and-forget and silently deleted nothing for a day — RLS had
  // no DELETE policy on invoice_tips, and Postgres renders that as "no rows
  // match", not an error. A count in the log is the difference between that
  // bug being invisible and being one grep away.
  const { data: cleanedTips, error: tipCleanupErr } = (await supabase
    .from("invoice_tips" as never)
    .delete()
    .eq("invoice_id" as never, invoiceId as never)
    .eq("provider_payment_id" as never, paymentId as never)
    .is("paid_out_at" as never, null as never)
    .select("id" as never)) as unknown as {
    data: Array<{ id: string }> | null;
    error: { message: string } | null;
  };
  if (tipCleanupErr) {
    console.error("[tips] cleanup on payment delete failed:", tipCleanupErr.message);
  } else if ((cleanedTips ?? []).length > 0) {
    console.log(
      `[tips] removed ${(cleanedTips ?? []).length} unpaid tip row(s) with payment ${paymentId}`,
    );
  }

  const { error } = await supabase
    .from("invoice_payments")
    .delete()
    .eq("id", paymentId);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "invoice",
    entity_id: invoiceId,
    before: prev ?? null,
  });

  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
}

// SendInvoiceState + the shared delivery routine live in @/lib/invoice-send so
// the auto-send cron can reuse them. This "use server" file may only export
// async actions, so consumers import the type from @/lib/invoice-send directly.

/**
 * Owner-facing delivery wrapper: enforce the owner/admin permission check and
 * that the invoice belongs to the caller's org (the core uses the admin client
 * and bypasses RLS), then hand off to the shared delivery routine.
 */
async function deliverInvoiceEmail(
  invoiceId: string,
): Promise<SendInvoiceState> {
  const { membership, supabase } = await getActionContext();

  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can send invoices." };
  }

  // Ownership check via the RLS-scoped client — a row comes back only if the
  // invoice is in the caller's org.
  const { data: owns } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", invoiceId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (!owns) return { error: "Invoice not found." };

  return deliverInvoiceEmailCore(invoiceId);
}

/**
 * Mark an invoice as "sent". Flips status draft → sent, stamps sent_at,
 * and emails the client a link to the public invoice page.
 *
 * Ordering matters: we SEND FIRST, then flip status. If delivery fails,
 * nothing changes in the DB and the user sees a descriptive error —
 * previously the action silently marked invoices as sent when email
 * wasn't configured, which is how "I test sent an invoice and nothing
 * got sent" turns into a 10-minute debug session.
 */
export async function sendInvoiceAction(
  _prev: SendInvoiceState,
  formData: FormData,
): Promise<SendInvoiceState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice id." };

  const delivered = await deliverInvoiceEmail(id);
  if (!delivered.ok) return delivered;

  const { membership, supabase } = await getActionContext();
  const { data: prev } = await supabase
    .from("invoices")
    .select("status, sent_at")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: prev?.sent_at ?? new Date().toISOString(),
      // A manual send supersedes any pending auto-send — clear the schedule so
      // no stale 'scheduled' state lingers on a now-sent invoice.
      auto_send_state: "sent",
      auto_send_at: null,
    } as never)
    .eq("id", id);
  if (error) return { error: error.message };

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "invoice",
    entity_id: id,
    before: { status: prev?.status ?? "draft" },
    after: { status: "sent" },
  });

  // Fire-and-forget push to Sage if the org has it connected. We don't
  // await — owners shouldn't wait on a bookkeeping sync before seeing
  // their invoice flip to sent. pushInvoiceToSage swallows its own
  // errors and logs them; idempotent via invoices.sage_invoice_id.
  pushInvoiceToSage(id).catch((err) =>
    console.error("[sage] background sync on send failed:", err),
  );
  // Same for QuickBooks — no-ops when the org hasn't connected it.
  pushInvoiceToQuickBooks(id).catch((err) =>
    console.error("[qbo] background sync on send failed:", err),
  );

  revalidatePath(`/app/invoices/${id}`);
  revalidatePath("/app/invoices");
  return { ok: true, messageId: delivered.messageId };
}

/**
 * Cancel a scheduled auto-send on a draft invoice ("Hold"). Flips
 * auto_send_state → 'held' and clears the timer so the cron skips it; the owner
 * can still send manually whenever they're ready.
 */
export async function holdInvoiceAutoSendAction(
  _prev: SendInvoiceState,
  formData: FormData,
): Promise<SendInvoiceState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice id." };

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can change invoices." };
  }

  const { error } = await (supabase
    .from("invoices")
    .update({ auto_send_state: "held", auto_send_at: null } as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("auto_send_state" as never, "scheduled" as never) as unknown as Promise<{
    error: { message: string } | null;
  }>);
  if (error) return { error: error.message };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "invoice",
    entity_id: id,
    after: { auto_send_state: "held" },
  });

  revalidatePath(`/app/invoices/${id}`);
  revalidatePath("/app/invoices");
  return { ok: true };
}

/**
 * Re-send the invoice email on an already-sent invoice without
 * touching status or sent_at. Used by the "Resend email" button on
 * invoices that are past the draft stage — critical for the "I clicked
 * Send but nothing arrived" debug path, since once status flips to
 * 'sent' the original button disappears and the owner has no way to
 * re-trigger delivery without this.
 */
export async function resendInvoiceEmailAction(
  _prev: SendInvoiceState,
  formData: FormData,
): Promise<SendInvoiceState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice id." };

  const delivered = await deliverInvoiceEmail(id);
  if (!delivered.ok) return delivered;

  // Refresh the page so any stale cached data updates, but status
  // and sent_at are intentionally untouched.
  revalidatePath(`/app/invoices/${id}`);
  return { ok: true, messageId: delivered.messageId };
}

/**
 * Manual Sage sync for an invoice. Used by the "Sync to Sage" button
 * on the invoice detail page when the background push on send didn't
 * stick (Sage was briefly unreachable, tokens refreshed oddly, etc.).
 * Idempotent — checks sage_invoice_id before POST-ing, so re-running
 * won't create duplicates.
 */
export type SyncSageState = {
  error?: string;
  ok?: boolean;
  sageInvoiceId?: string;
};

export async function syncInvoiceToSageAction(
  _prev: SyncSageState,
  formData: FormData,
): Promise<SyncSageState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice id." };

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can push to Sage." };
  }

  const result = await pushInvoiceToSage(id);
  if (!result.id) {
    // Sage's actual reason, not a guess — see pushInvoiceToSage.
    return {
      error:
        result.error ??
        "Couldn't push to Sage. Check the Vercel logs for [sage] entries.",
    };
  }

  revalidatePath(`/app/invoices/${id}`);
  return { ok: true, sageInvoiceId: result.id };
}

/**
 * Manual QuickBooks sync for an invoice — the retry path when the background
 * push on send didn't stick. Idempotent via invoices.quickbooks_invoice_id.
 */
export type SyncQuickBooksState = {
  error?: string;
  ok?: boolean;
  qbInvoiceId?: string;
};

export async function syncInvoiceToQuickBooksAction(
  _prev: SyncQuickBooksState,
  formData: FormData,
): Promise<SyncQuickBooksState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice id." };

  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can push to QuickBooks." };
  }

  const result = await pushInvoiceToQuickBooks(id);
  if (!result.id) {
    // QuickBooks' actual reason, not a guess — see pushInvoiceToQuickBooks.
    return {
      error:
        result.error ??
        "Couldn't push to QuickBooks. Check the Vercel logs for [qbo] entries.",
    };
  }

  revalidatePath(`/app/invoices/${id}`);
  return { ok: true, qbInvoiceId: result.id };
}

/**
 * Void an invoice — soft-delete equivalent. Once voided, payments cannot
 * be recorded against it. The sync trigger flips status to 'void'.
 */
export async function voidInvoiceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  // Voiding reverses revenue recognition — owner/admin only.
  if (!["owner", "admin"].includes(membership.role)) {
    throw new Error("Only owners and admins can void invoices.");
  }

  const { data: prev } = await supabase
    .from("invoices")
    .select("id, status, voided_at, payments:invoice_payments ( amount_cents, refunded_cents )")
    .eq("id", id)
    .maybeSingle();
  if (!prev || prev.voided_at) return;

  // Void is for invoices that were never really owed — a duplicate, a
  // mistake. An invoice with money actually received on it is a different
  // animal: voiding it makes the public page tell the client "no payment
  // required" while their money stays taken, with no refund ever issued and
  // the payment rows orphaned under a void. Undo the money first (refund the
  // card payment, or delete a mistyped manual row), then void.
  const netPaid = netPaidCents(
    (prev as { payments?: Array<{ amount_cents: number; refunded_cents: number | null }> })
      .payments ?? [],
  );
  if (netPaid > 0) {
    redirect(`/app/invoices/${id}?error=void_has_payments`);
  }

  const { error } = await supabase
    .from("invoices")
    .update({ voided_at: new Date().toISOString(), status: "void" })
    .eq("id", id);
  if (error) throw error;

  // Un-stamp any bookings billed on this invoice — voided work is billable
  // again. Without this (plus the now-partial period-key index), a voided
  // consolidated invoice left its bookings stamped and its period key
  // occupied, so the billing cron could never re-bill the period (audit P4).
  const { error: unstampErr } = await supabase
    .from("bookings")
    .update({ billing_invoice_id: null } as never)
    .eq("billing_invoice_id" as never, id as never)
    .eq("organization_id", membership.organization_id);
  if (unstampErr) {
    console.error(
      `[invoices] void un-stamp failed for invoice ${id}:`,
      unstampErr.message,
    );
  }

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "invoice",
    entity_id: id,
    before: { status: prev.status },
    after: { status: "void" },
  });

  revalidatePath(`/app/invoices/${id}`);
  revalidatePath("/app/invoices");
}

/**
 * Generate a review token for a paid invoice so the client can leave a review
 * via the public /review/:token page. Idempotent — returns existing token if
 * one is already set.
 */
export async function generateReviewTokenAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  // Check if token already exists
  const { data: invoice } = (await supabase
    .from("invoices")
    .select("id, review_token, status")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: { id: string; review_token: string | null; status: string } | null;
  };

  if (!invoice) return;

  // Only allow for paid invoices
  if (invoice.status !== "paid") return;

  if (!invoice.review_token) {
    const token = generateClaimToken(16);
    const { error: tokenErr } = await supabase
      .from("invoices")
      .update({ review_token: token } as never)
      .eq("id", id);

    if (tokenErr) {
      console.error("[invoices] generateReviewToken failed:", tokenErr.message);
      return;
    }

    await logAuditEvent({
      membership,
      action: "update",
      entity: "invoice",
      entity_id: id,
      after: { review_token_generated: true },
    });
  }

  revalidatePath(`/app/invoices/${id}`);
}

export async function deleteInvoiceAction(
  formData: FormData,
): Promise<{ ok: false; error: string } | void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  // Hard-delete of a financial document — owner/admin only. Guard
  // outcomes RETURN, never throw: a thrown error in a form action is the
  // Next error page for the user and a Sentry page for us (SOLLOS3-Q),
  // when all the guard wants to say is "not like this".
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Only owners and admins can delete invoices." };
  }

  const { data: prev } = await supabase
    .from("invoices")
    .select(
      "status, amount_cents, client_id, payments:invoice_payments ( amount_cents, refunded_cents )",
    )
    .eq("id", id)
    .maybeSingle();

  // The void guard's twin — and delete is the harsher door. Two days ago
  // voiding an invoice with money on it was blocked; deleting one was not,
  // and deleting erases the PAYMENT ROWS with it: recorded money, gone from
  // the books entirely. Same rule, same exit: undo the money first (refund
  // the card payment, delete a mistyped manual row), then this works.
  const paidCents = netPaidCents(
    (prev as {
      payments?: Array<{ amount_cents: number; refunded_cents: number | null }>;
    } | null)?.payments ?? [],
  );
  if (paidCents > 0) {
    return {
      ok: false,
      error:
        "This invoice has recorded payments. Refund or remove the payments first — deleting it now would erase money from the books.",
    };
  }

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "invoice",
    entity_id: id,
    before: prev ?? null,
  });

  revalidatePath("/app/invoices");
  // The deleted invoice's own page is gone, so the list is the right
  // fallback — but if they came from a client, that is where they belong.
  redirectBack(formData, "/app/invoices");
}

/**
 * One-click bulk invoice generation. Finds every completed booking in
 * this org that has no invoice yet and generates a draft invoice for
 * each one. Skips bookings that already have an invoice or have no
 * client / total_cents set.
 *
 * Returns a structured result (not a redirect) so the client can show
 * a toast with the outcome without a full page refresh.
 */
export type BulkInvoiceResult = {
  created: number;
  skipped: number;
  errors: string[];
};

export async function bulkGenerateInvoicesAction(): Promise<BulkInvoiceResult> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { created: 0, skipped: 0, errors: ["Permission denied."] };
  }

  // Find completed bookings with a total set that have no invoice yet.
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id")
    .eq("organization_id" as never, membership.organization_id as never)
    .eq("status", "completed")
    .not("total_cents", "is", null)
    .is("archived_at" as never, null as never);

  if (error) return { created: 0, skipped: 0, errors: [error.message] };
  if (!bookings?.length) return { created: 0, skipped: 0, errors: [] };

  // Filter to those without an existing invoice.
  const { data: existing } = await supabase
    .from("invoices")
    .select("booking_id")
    .eq("organization_id" as never, membership.organization_id as never)
    .not("booking_id", "is", null)
    .in(
      "booking_id",
      bookings.map((b) => b.id),
    );

  const alreadyInvoiced = new Set(
    (existing ?? []).map((r) => r.booking_id as string),
  );

  // Also exclude bookings already billed on a consolidated "period" invoice —
  // those are recorded via invoice_line_items.booking_id (invoices.booking_id
  // is null), so the single-invoice check above misses them. Void invoices
  // don't count. Without this the booking gets a second invoice.
  const { data: liExisting } = (await supabase
    .from("invoice_line_items")
    .select("booking_id, invoices!inner ( voided_at )")
    .in(
      "booking_id" as never,
      bookings.map((b) => b.id) as never,
    )
    .is("invoices.voided_at" as never, null as never)) as unknown as {
    data: Array<{ booking_id: string | null }> | null;
  };
  for (const r of liExisting ?? []) {
    if (r.booking_id) alreadyInvoiced.add(r.booking_id);
  }

  const uninvoiced = bookings.filter((b) => !alreadyInvoiced.has(b.id));

  if (!uninvoiced.length) return { created: 0, skipped: bookings.length, errors: [] };

  let created = 0;
  const errors: string[] = [];

  // Process in series — autoInvoiceOnJobComplete does its own DB writes;
  // parallel execution risks duplicate invoice creation on slow DB.
  for (const b of uninvoiced) {
    const result = await autoInvoiceOnJobComplete(b.id, { force: true });
    if (result.ok) {
      created++;
    } else {
      errors.push(result.reason);
    }
  }

  revalidatePath("/app/invoices");
  return {
    created,
    skipped: bookings.length - uninvoiced.length,
    errors,
  };
}

// ── Bill for a period (consolidated invoice) ─────────────────────────────────

export type PeriodInvoiceState = ActionState<"_form">;

/**
 * Create one consolidated invoice from a set of line items — typically a
 * month of bookings pre-loaded by the period page, then edited by the user.
 * Lines that came from a booking carry booking_id so that work shows as
 * invoiced and won't be billed again. Owner/admin only.
 */
export async function createPeriodInvoiceAction(
  _prev: PeriodInvoiceState,
  formData: FormData,
): Promise<PeriodInvoiceState> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }
  if (!(await canCreateData(membership.organization_id))) {
    return {
      errors: {
        _form:
          "Your subscription has expired. Subscribe to create new invoices.",
      },
    };
  }

  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { errors: { _form: "Pick a client." } };
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = dueDateRaw.length > 0 ? dueDateRaw : null;

  let rawLines: Array<{
    label?: string;
    quantity?: string;
    unit_price_dollars?: string;
    booking_id?: string | null;
  }>;
  try {
    const arr = JSON.parse(String(formData.get("line_items_json") ?? "[]"));
    if (!Array.isArray(arr)) throw new Error("not array");
    rawLines = arr;
  } catch {
    return { errors: { _form: "Invalid line items." } };
  }

  // Keep only lines with a label, compute cents per line + subtotal.
  const lineRows = rawLines
    .map((l, idx) => {
      const label = String(l.label ?? "").trim();
      const qty = Number(l.quantity ?? "1") || 0;
      const unit = parseDollarsToCents(String(l.unit_price_dollars ?? "")) ?? 0;
      return {
        label,
        quantity: qty,
        unit_price_cents: unit,
        booking_id: l.booking_id || null,
        sort_order: idx,
        line_cents: Math.round(qty * unit),
      };
    })
    .filter((r) => r.label.length > 0);

  if (lineRows.length === 0) {
    return { errors: { _form: "Add at least one line item." } };
  }

  const subtotalCents = lineRows.reduce((s, r) => s + r.line_cents, 0);
  const rateBps = parseTaxRate(String(formData.get("tax_rate_percent") ?? ""));
  const taxLabelRaw = String(formData.get("tax_label") ?? "").trim();
  const tax = computeTax(subtotalCents, { rateBps });

  // The invoice is consolidated, so there's no single booking_id on it —
  // the bookings are tracked per line item instead.
  const { data: inv, error: invErr } = (await supabase
    .from("invoices")
    .insert({
      organization_id: membership.organization_id,
      client_id: clientId,
      booking_id: null,
      status: "draft",
      amount_cents: tax.totalCents,
      tax_rate_bps: tax.rateBps,
      tax_amount_cents: tax.taxAmountCents,
      tax_label: tax.rateBps ? taxLabelRaw || null : null,
      due_date: dueDate,
      sent_at: null,
      paid_at: null,
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (invErr || !inv) {
    return { errors: { _form: invErr?.message ?? "Couldn't create invoice." } };
  }

  const itemsPayload = lineRows.map((r) => ({
    invoice_id: inv.id,
    organization_id: membership.organization_id,
    label: r.label,
    quantity: r.quantity,
    unit_price_cents: r.unit_price_cents,
    sort_order: r.sort_order,
    booking_id: r.booking_id,
  }));
  const { error: itemsErr } = (await (supabase
    .from("invoice_line_items")
    .insert(itemsPayload as never) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (itemsErr) return { errors: { _form: itemsErr.message } };

  // Stamp every booking on this invoice as billed — the same guard
  // createInvoiceAction applies at the top of this file, which the period
  // builder never did.
  //
  // A consolidated invoice has no single invoices.booking_id (it is set null
  // above), so the ONLY record that this work is billed lives on the line
  // items. The billing-cycle cron does not read those: it selects bookings
  // with billing_invoice_id IS NULL (api/cron/billing-cycle/route.ts:166).
  // So for a monthly or biweekly client, every job billed here was invisible
  // to the cron and would be billed a second time on the 1st or 15th.
  //
  // Guarded on still-null so a booking already linked to another invoice is
  // never re-pointed at this one.
  const billedBookingIds = Array.from(
    new Set(lineRows.map((r) => r.booking_id).filter(Boolean) as string[]),
  );
  if (billedBookingIds.length > 0) {
    const { error: stampErr } = await supabase
      .from("bookings")
      .update({ billing_invoice_id: inv.id } as never)
      .in("id", billedBookingIds)
      .eq("organization_id", membership.organization_id)
      .is("billing_invoice_id" as never, null as never);
    if (stampErr) {
      console.error(
        `[invoices] period invoice ${inv.id}: billing_invoice_id stamp failed (invoice still created):`,
        stampErr.message,
      );
    }
  }

  // Fold in the per-job drafts this invoice replaces.
  //
  // Auto-invoicing raises a draft as each job finishes, so billing a period
  // afterwards means most of it is already spoken for. Those jobs used to be
  // filtered out in silence — the invoice came back short and nothing said
  // why. The builder now lists them and lets the owner tick the DRAFTS to
  // consolidate; their lines are already in this invoice, so the drafts must
  // now be voided or the work is billed twice.
  //
  // Only drafts, only this client, only this org — re-proved here rather than
  // trusted from the form, because voiding is money and the ids arrived in a
  // POST body. A sent or paid invoice is never absorbed: the client already
  // has it, and quietly voiding it would erase something they can see.
  let absorbIds: string[] = [];
  try {
    const raw = JSON.parse(String(formData.get("absorb_invoice_ids") ?? "[]"));
    if (Array.isArray(raw)) {
      absorbIds = raw.filter((v): v is string => typeof v === "string");
    }
  } catch {
    absorbIds = [];
  }
  let absorbed = 0;
  if (absorbIds.length > 0) {
    const { data: voidable } = (await supabase
      .from("invoices")
      .select("id")
      .in("id", absorbIds)
      .eq("client_id", clientId)
      .eq("organization_id", membership.organization_id)
      .eq("status", "draft")
      .neq("id", inv.id)) as unknown as { data: Array<{ id: string }> | null };

    const ids = (voidable ?? []).map((r) => r.id);
    if (ids.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: voidErr } = await supabase
        .from("invoices")
        .update({ status: "void", voided_at: nowIso })
        .in("id", ids);
      if (voidErr) {
        console.error(
          `[invoices] period invoice ${inv.id}: consolidating drafts failed (invoice still created):`,
          voidErr.message,
        );
      } else {
        absorbed = ids.length;
        // Point the freed bookings at the invoice that now bills them. The
        // stamp above only claimed bookings that were still unstamped, so
        // these were skipped precisely BECAUSE the draft held them.
        await supabase
          .from("bookings")
          .update({ billing_invoice_id: inv.id } as never)
          .in("billing_invoice_id" as never, ids as never)
          .eq("organization_id", membership.organization_id);
        for (const voidedId of ids) {
          await logAuditEvent({
            membership,
            action: "status_change",
            entity: "invoice",
            entity_id: voidedId,
            before: { status: "draft" },
            after: { status: "void", consolidated_into: inv.id },
          });
        }
      }
    }
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "invoice",
    entity_id: inv.id,
    after: {
      client_id: clientId,
      amount_cents: tax.totalCents,
      lines: lineRows.length,
      billed_bookings: billedBookingIds.length,
      consolidated_drafts: absorbed,
    },
  });

  revalidatePath("/app/invoices");
  revalidatePath("/app");
  redirect(`/app/invoices/${inv.id}/edit`);
}
