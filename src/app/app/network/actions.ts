"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { NetworkContactSchema } from "@/lib/validators/network";

type Field = keyof typeof NetworkContactSchema.shape;
export type NetworkContactFormState = ActionState<Field>;

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "other"),
    company: String(formData.get("company") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createNetworkContactAction(
  _prev: NetworkContactFormState,
  formData: FormData,
): Promise<NetworkContactFormState> {
  const raw = readForm(formData);
  const parsed = parseForm(NetworkContactSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  const { data: inserted, error } = (await supabase
    .from("network_contacts" as never)
    .insert({
      organization_id: membership.organization_id,
      name: parsed.data.name,
      category: parsed.data.category,
      company: parsed.data.company || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
      created_by: membership.id,
    } as never)
    .select("id")
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error) return { errors: { _form: error.message }, values: raw };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "network_contact",
    entity_id: inserted?.id ?? null,
    after: { name: parsed.data.name, category: parsed.data.category },
  });

  revalidatePath("/app/network");
  redirect("/app/network");
}

export async function updateNetworkContactAction(
  id: string,
  _prev: NetworkContactFormState,
  formData: FormData,
): Promise<NetworkContactFormState> {
  const raw = readForm(formData);
  const parsed = parseForm(NetworkContactSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Explicit org filter on top of RLS — the standing multi-org rule.
  const { error } = (await supabase
    .from("network_contacts" as never)
    .update({
      name: parsed.data.name,
      category: parsed.data.category,
      company: parsed.data.company || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    } as never)
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )) as unknown as { error: { message: string } | null };
  if (error) return { errors: { _form: error.message }, values: raw };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "network_contact",
    entity_id: id,
    after: { name: parsed.data.name, category: parsed.data.category },
  });

  revalidatePath("/app/network");
  redirect("/app/network");
}

export async function deleteNetworkContactAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { membership, supabase } = await getActionContext();

  const { data: existing } = (await supabase
    .from("network_contacts" as never)
    .select("id, name")
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as { data: { name: string } | null };
  if (!existing) return;

  const { error } = (await supabase
    .from("network_contacts" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )) as unknown as { error: { message: string } | null };
  if (error) return;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "network_contact",
    entity_id: id,
    before: { name: existing.name },
  });

  revalidatePath("/app/network");
  redirect("/app/network");
}
