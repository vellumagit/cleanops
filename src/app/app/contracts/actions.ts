"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { ContractSchema } from "@/lib/validators/contracts";

type Field = keyof typeof ContractSchema.shape;
export type ContractFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    client_id: String(formData.get("client_id") ?? ""),
    estimate_id: String(formData.get("estimate_id") ?? ""),
    service_type: String(formData.get("service_type") ?? "standard"),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    agreed_price_cents: String(formData.get("agreed_price_cents") ?? ""),
    payment_terms: String(formData.get("payment_terms") ?? ""),
    status: String(formData.get("status") ?? "active"),
  };
}

export async function createContractAction(
  _prev: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ContractSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("contracts").insert({
    organization_id: membership.organization_id,
    client_id: parsed.data.client_id,
    estimate_id: parsed.data.estimate_id,
    service_type: parsed.data.service_type,
    start_date: parsed.data.start_date,
    end_date: parsed.data.end_date,
    agreed_price_cents: parsed.data.agreed_price_cents,
    payment_terms: parsed.data.payment_terms ?? null,
    status: parsed.data.status,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/contracts");
  revalidatePath("/app");
  redirect("/app/contracts");
}

export async function updateContractAction(
  id: string,
  _prev: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ContractSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { supabase } = await getActionContext();
  const { error } = await supabase
    .from("contracts")
    .update({
      client_id: parsed.data.client_id,
      estimate_id: parsed.data.estimate_id,
      service_type: parsed.data.service_type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      agreed_price_cents: parsed.data.agreed_price_cents,
      payment_terms: parsed.data.payment_terms ?? null,
      status: parsed.data.status,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/contracts");
  revalidatePath(`/app/contracts/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/contracts");
}

export async function deleteContractAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await getActionContext();
  const { error } = await supabase.from("contracts").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/contracts");
  redirect("/app/contracts");
}
