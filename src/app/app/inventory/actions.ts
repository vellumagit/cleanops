"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { InventorySchema } from "@/lib/validators/inventory";

type Field = keyof typeof InventorySchema.shape;
export type InventoryFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "consumable"),
    quantity: String(formData.get("quantity") ?? ""),
    reorder_threshold: String(formData.get("reorder_threshold") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

export async function createInventoryAction(
  _prev: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InventorySchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("inventory_items").insert({
    organization_id: membership.organization_id,
    name: parsed.data.name,
    category: parsed.data.category,
    quantity: parsed.data.quantity,
    reorder_threshold: parsed.data.reorder_threshold,
    assigned_to: parsed.data.assigned_to,
    notes: parsed.data.notes ?? null,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/inventory");
  redirect("/app/inventory");
}

export async function updateInventoryAction(
  id: string,
  _prev: InventoryFormState,
  formData: FormData,
): Promise<InventoryFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(InventorySchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase
    .from("inventory_items")
    .update({
      name: parsed.data.name,
      category: parsed.data.category,
      quantity: parsed.data.quantity,
      reorder_threshold: parsed.data.reorder_threshold,
      assigned_to: parsed.data.assigned_to,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/inventory");
  revalidatePath(`/app/inventory/${id}/edit`);
  redirect("/app/inventory");
}

export async function deleteInventoryAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .eq("organization_id", membership.organization_id);
  if (error) throw error;
  revalidatePath("/app/inventory");
  redirect("/app/inventory");
}
