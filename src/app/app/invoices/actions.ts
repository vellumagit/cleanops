"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { InvoiceSchema } from "@/lib/validators/invoices";

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
  const { error } = await supabase.from("invoices").insert({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    booking_id: parsed.data.booking_id,
    status: parsed.data.status,
    amount_cents: parsed.data.amount_cents,
    due_date: parsed.data.due_date,
    sent_at: stamps.sent_at,
    paid_at: stamps.paid_at,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  redirect("/app/invoices");
}

export async function updateInvoiceAction(
  id: string,
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InvoiceSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { supabase } = await getActionContext();
  const { data: prev } = await supabase
    .from("invoices")
    .select("sent_at, paid_at")
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
  revalidatePath("/app/invoices");
  revalidatePath(`/app/invoices/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/invoices");
}

export async function deleteInvoiceAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await getActionContext();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/invoices");
  redirect("/app/invoices");
}
