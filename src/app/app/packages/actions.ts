"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { PackageSchema } from "@/lib/validators/packages";

type Field = keyof typeof PackageSchema.shape;
export type PackageFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    duration_minutes: String(formData.get("duration_minutes") ?? ""),
    price_cents: String(formData.get("price_cents") ?? ""),
    is_active: String(formData.get("is_active") ?? ""),
    included: String(formData.get("included") ?? ""),
  };
}

export async function createPackageAction(
  _prev: PackageFormState,
  formData: FormData,
): Promise<PackageFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(PackageSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("packages").insert({
    organization_id: membership.organization_id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    duration_minutes: parsed.data.duration_minutes,
    price_cents: parsed.data.price_cents,
    is_active: parsed.data.is_active,
    included: parsed.data.included,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/packages");
  revalidatePath("/app");
  redirect("/app/packages");
}

export async function updatePackageAction(
  id: string,
  _prev: PackageFormState,
  formData: FormData,
): Promise<PackageFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(PackageSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { supabase } = await getActionContext();
  const { error } = await supabase
    .from("packages")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      duration_minutes: parsed.data.duration_minutes,
      price_cents: parsed.data.price_cents,
      is_active: parsed.data.is_active,
      included: parsed.data.included,
    })
    .eq("id", id);

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/packages");
  revalidatePath(`/app/packages/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/packages");
}

export async function deletePackageAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await getActionContext();
  const { error } = await supabase.from("packages").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/packages");
  redirect("/app/packages");
}
