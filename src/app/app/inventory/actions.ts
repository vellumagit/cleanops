"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { InventorySchema } from "@/lib/validators/inventory";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";

/**
 * An item has just dropped to its low-stock level (or was saved already at
 * it): give whoever looks after it a task and tell them. The office is told
 * about low stock by the database itself (the "Low stock: ..." notice), so
 * with nobody assigned there is nothing more to do. One open task per item and person:
 * saving the item again while that task is still open adds nothing.
 * Best-effort; a failure here never fails the save.
 */
async function raiseLowStock(input: {
  organizationId: string;
  actorId: string;
  name: string;
  quantity: number;
  threshold: number;
  assignedTo: string | null | undefined;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const title = `Restock: ${input.name}`;
    const body = `${input.name} is down to ${input.quantity} (low-stock level ${input.threshold}).`;
    if (!input.assignedTo) return;
    const { data: who } = (await admin
      .from("memberships")
      .select("role")
      .eq("id", input.assignedTo)
      .eq("organization_id", input.organizationId)
      .maybeSingle()) as unknown as { data: { role: string } | null };
    if (!who) return;
    const { data: open } = (await admin
      .from("tasks")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("assigned_to", input.assignedTo)
      .eq("title", title)
      .is("completed_at", null)
      .limit(1)) as unknown as { data: Array<{ id: string }> | null };
    if (open?.length) return;
    const { error } = await admin.from("tasks").insert({
      organization_id: input.organizationId,
      created_by: input.actorId,
      assigned_to: input.assignedTo,
      title,
      notes: body,
    });
    if (error) throw new Error(error.message);
    await notify({
      organizationId: input.organizationId,
      audience: "membership",
      membershipId: input.assignedTo,
      title: "Low stock: a task for you",
      body,
      href: who.role === "employee" ? "/field/tasks" : "/app/tasks",
    });
  } catch (err) {
    console.error("[inventory] low-stock task failed:", err);
  }
}

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
  if (parsed.data.quantity <= parsed.data.reorder_threshold) {
    await raiseLowStock({
      organizationId: membership.organization_id,
      actorId: membership.id,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      threshold: parsed.data.reorder_threshold,
      assignedTo: parsed.data.assigned_to,
    });
  }
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
  // What it was before, to tell "just went low" from "was already low".
  const { data: before } = (await supabase
    .from("inventory_items")
    .select("quantity, reorder_threshold, assigned_to")
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { quantity: number; reorder_threshold: number; assigned_to: string | null } | null;
  };
  const { data: savedRows, error } = await supabase
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
    .eq("organization_id", membership.organization_id)
    .select("id");

  if (error) return { errors: { _form: error.message }, values: raw };
  if (!savedRows?.length) {
    return { errors: { _form: "This item wasn't saved. It may have been deleted, or your access doesn't allow changing it." }, values: raw };
  }
  // Low now, and either it wasn't before or it has a new person to tell.
  const lowNow = parsed.data.quantity <= parsed.data.reorder_threshold;
  const lowBefore = before ? before.quantity <= before.reorder_threshold : false;
  const newPerson = (parsed.data.assigned_to ?? null) !== (before?.assigned_to ?? null);
  if (lowNow && (!lowBefore || newPerson)) {
    await raiseLowStock({
      organizationId: membership.organization_id,
      actorId: membership.id,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      threshold: parsed.data.reorder_threshold,
      assignedTo: parsed.data.assigned_to,
    });
  }
  revalidatePath("/app/inventory");
  revalidatePath("/app/tasks");
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
