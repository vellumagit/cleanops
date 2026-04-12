"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { EstimateSchema } from "@/lib/validators/estimates";
import { autoBookingOnEstimateApproval } from "@/lib/automations";

type Field = keyof typeof EstimateSchema.shape;
export type EstimateFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    service_description: String(formData.get("service_description") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    status: String(formData.get("status") ?? "draft"),
    total_cents: String(formData.get("total_cents") ?? ""),
  };
}

function maybeStamp(status: string, prev?: { sent_at?: string | null; decided_at?: string | null }) {
  const now = new Date().toISOString();
  return {
    sent_at:
      status === "sent" || status === "approved" || status === "declined"
        ? prev?.sent_at ?? now
        : null,
    decided_at:
      status === "approved" || status === "declined"
        ? prev?.decided_at ?? now
        : null,
  };
}

export async function createEstimateAction(
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(EstimateSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const stamps = maybeStamp(parsed.data.status);
  const { error } = await supabase.from("estimates").insert({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    service_description: parsed.data.service_description ?? null,
    notes: parsed.data.notes ?? null,
    status: parsed.data.status,
    total_cents: parsed.data.total_cents,
    sent_at: stamps.sent_at,
    decided_at: stamps.decided_at,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/estimates");
  revalidatePath("/app");
  redirect("/app/estimates");
}

export async function updateEstimateAction(
  id: string,
  _prev: EstimateFormState,
  formData: FormData,
): Promise<EstimateFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(EstimateSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { supabase } = await getActionContext();

  // Pull previous timestamps so we don't overwrite an earlier sent_at.
  const { data: prev } = await supabase
    .from("estimates")
    .select("sent_at, decided_at")
    .eq("id", id)
    .maybeSingle();

  const stamps = maybeStamp(parsed.data.status, prev ?? undefined);
  const { error } = await supabase
    .from("estimates")
    .update({
      client_id: parsed.data.client_id,
      service_description: parsed.data.service_description ?? null,
      notes: parsed.data.notes ?? null,
      status: parsed.data.status,
      total_cents: parsed.data.total_cents,
      sent_at: stamps.sent_at,
      decided_at: stamps.decided_at,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };

  // If the estimate was just approved, auto-create a pending booking
  if (parsed.data.status === "approved") {
    autoBookingOnEstimateApproval(id).catch(() => {});
  }

  revalidatePath("/app/estimates");
  revalidatePath(`/app/estimates/${id}/edit`);
  revalidatePath("/app/bookings");
  revalidatePath("/app");
  redirect("/app/estimates");
}

export async function deleteEstimateAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await getActionContext();
  const { error } = await supabase.from("estimates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/estimates");
  redirect("/app/estimates");
}
