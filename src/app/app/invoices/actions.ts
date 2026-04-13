"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { InvoiceSchema } from "@/lib/validators/invoices";
import {
  InvoicePaymentSchema,
  type PAYMENT_METHODS,
} from "@/lib/validators/invoice-payment";
import { generateClaimToken } from "@/lib/claim-token";

type Field = keyof typeof InvoiceSchema.shape;
export type InvoiceFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    booking_id: String(formData.get("booking_id") ?? ""),
    status: String(formData.get("status") ?? "draft"),
    amount_cents: String(formData.get("amount_cents") ?? ""),
    due_date: String(formData.get("due_date") ?? ""),
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

export async function createInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InvoiceSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const stamps = maybeStamp(parsed.data.status);
  const { data: inserted, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: membership.organization_id,
      client_id: parsed.data.client_id,
      booking_id: parsed.data.booking_id,
      status: parsed.data.status,
      amount_cents: parsed.data.amount_cents,
      due_date: parsed.data.due_date,
      sent_at: stamps.sent_at,
      paid_at: stamps.paid_at,
    })
    .select("id")
    .single();

  if (error || !inserted)
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "invoice",
    entity_id: inserted.id,
    after: {
      status: parsed.data.status,
      amount_cents: parsed.data.amount_cents,
      client_id: parsed.data.client_id,
    },
  });

  revalidatePath("/app/invoices");
  revalidatePath("/app");
  redirect(`/app/invoices/${inserted.id}/edit`);
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
    .select("status, amount_cents, sent_at, paid_at, client_id")
    .eq("id", id)
    .maybeSingle();

  const stamps = maybeStamp(parsed.data.status, prev ?? undefined);
  const { error } = await supabase
    .from("invoices")
    .update({
      client_id: parsed.data.client_id,
      booking_id: parsed.data.booking_id,
      status: parsed.data.status,
      amount_cents: parsed.data.amount_cents,
      due_date: parsed.data.due_date,
      sent_at: stamps.sent_at,
      paid_at: stamps.paid_at,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  // Promote a status change to its own audit action so the viewer can
  // distinguish a "mark paid" from a generic update.
  const becamePaid = prev?.status !== "paid" && parsed.data.status === "paid";
  await logAuditEvent({
    membership,
    action: becamePaid
      ? "mark_paid"
      : prev?.status !== parsed.data.status
        ? "status_change"
        : "update",
    entity: "invoice",
    entity_id: id,
    before: prev ?? null,
    after: {
      status: parsed.data.status,
      amount_cents: parsed.data.amount_cents,
      paid_at: stamps.paid_at,
    },
  });

  revalidatePath("/app/invoices");
  revalidatePath(`/app/invoices/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/invoices");
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

  // Guard: invoice must belong to the caller's org. RLS will enforce this
  // anyway, but fetching first lets us return a clean error.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, organization_id, amount_cents, voided_at")
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

  const { data: inserted, error } = await supabase
    .from("invoice_payments")
    .insert({
      organization_id: invoice.organization_id,
      invoice_id: invoice.id,
      amount_cents: parsed.data.amount_dollars, // schema already converted to cents
      method: parsed.data.method as (typeof PAYMENT_METHODS)[number],
      reference: parsed.data.reference ?? null,
      notes: parsed.data.notes ?? null,
      received_at: new Date(parsed.data.received_at).toISOString(),
      recorded_by: membership.id,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };
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
    },
  });

  revalidatePath(`/app/invoices/${invoice.id}`);
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  return {};
}

/**
 * Delete a manual payment row. The trigger will recompute invoice totals.
 */
export async function deleteInvoicePaymentAction(formData: FormData) {
  const paymentId = String(formData.get("payment_id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!paymentId || !invoiceId) return;

  const { membership, supabase } = await getActionContext();

  const { data: prev } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, amount_cents, method, reference, provider")
    .eq("id", paymentId)
    .maybeSingle();

  // Never let a user delete a processor-originated payment manually —
  // that has to come back through a refund webhook or it'll desync.
  if (prev?.provider) {
    throw new Error(
      "Processor payments can't be removed manually. Issue a refund through the processor instead.",
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

/**
 * Mark an invoice as "sent". Flips status draft → sent and stamps sent_at.
 * In a later phase this also triggers the Resend email delivery — for now
 * it just flips the state so the public token/link can be shared manually.
 */
export async function sendInvoiceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: prev } = await supabase
    .from("invoices")
    .select("id, status, sent_at, public_token")
    .eq("id", id)
    .maybeSingle();
  if (!prev) return;

  const { error } = await supabase
    .from("invoices")
    .update({
      status: "sent",
      sent_at: prev.sent_at ?? new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "status_change",
    entity: "invoice",
    entity_id: id,
    before: { status: prev.status },
    after: { status: "sent" },
  });

  revalidatePath(`/app/invoices/${id}`);
  revalidatePath("/app/invoices");
}

/**
 * Void an invoice — soft-delete equivalent. Once voided, payments cannot
 * be recorded against it. The sync trigger flips status to 'void'.
 */
export async function voidInvoiceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: prev } = await supabase
    .from("invoices")
    .select("id, status, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!prev || prev.voided_at) return;

  const { error } = await supabase
    .from("invoices")
    .update({ voided_at: new Date().toISOString(), status: "void" })
    .eq("id", id);
  if (error) throw error;

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

export async function deleteInvoiceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: prev } = await supabase
    .from("invoices")
    .select("status, amount_cents, client_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "invoice",
    entity_id: id,
    before: prev ?? null,
  });

  revalidatePath("/app/invoices");
  redirect("/app/invoices");
}
