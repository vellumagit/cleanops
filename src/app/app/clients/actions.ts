"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { ClientSchema } from "@/lib/validators/clients";

type Field = keyof typeof ClientSchema.shape;
export type ClientFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    preferred_contact: String(formData.get("preferred_contact") ?? "email"),
  };
}

export async function createClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  const { data: inserted, error } = await supabase
    .from("clients")
    .insert({
      organization_id: membership.organization_id,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: inserted.id,
    after: { name: parsed.data.name, email: parsed.data.email ?? null },
  });

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirect("/app/clients");
}

export async function updateClientAction(
  id: string,
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("clients")
    .select("name, email, phone, address, notes, preferred_contact")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
    })
    .eq("id", id);

  if (error) {
    return { errors: { _form: error.message }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
    after: {
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
    },
  });

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/clients");
}

export async function deleteClientAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  const { data: previous } = await supabase
    .from("clients")
    .select("name, email")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("clients").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
  });

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirect("/app/clients");
}
