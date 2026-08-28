"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

export type HiringDocFormState = {
  error?: string;
  savedAt?: number;
};

const KINDS = new Set(["questionnaire", "procedure"]);

/**
 * Create or update one hiring doc. Items arrive as one-per-line text —
 * the same monkey-simple editing the rest of the app uses for lists —
 * and store as an ordered jsonb array.
 */
export async function saveHiringDocAction(
  _prev: HiringDocFormState,
  formData: FormData,
): Promise<HiringDocFormState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can edit the hiring library." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const itemsRaw = String(formData.get("items") ?? "");

  if (!KINDS.has(kind)) return { error: "Unknown document kind." };
  if (!title) return { error: "Give it a title." };
  const items = itemsRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 100);
  if (items.length === 0) {
    return {
      error:
        kind === "questionnaire"
          ? "Add at least one question (one per line)."
          : "Add at least one step (one per line).",
    };
  }

  const admin = createSupabaseAdminClient();
  if (id) {
    const { error } = await admin
      .from("hiring_docs" as never)
      .update({
        title,
        items,
        notes: notes || null,
      } as never)
      .eq("id" as never, id as never)
      .eq("organization_id" as never, membership.organization_id as never);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin.from("hiring_docs" as never).insert({
      organization_id: membership.organization_id,
      kind,
      title,
      items,
      notes: notes || null,
      created_by: membership.id,
    } as never);
    if (error) return { error: error.message };
  }

  await logAuditEvent({
    membership,
    action: id ? "update" : "create",
    entity: "settings",
    entity_id: id || membership.organization_id,
    after: { entity_name: "hiring_doc", kind, title, item_count: items.length },
  });

  revalidatePath("/app/hiring");
  return { savedAt: Date.now() };
}

export async function deleteHiringDocAction(formData: FormData): Promise<void> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = createSupabaseAdminClient();
  await admin
    .from("hiring_docs" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never);

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "settings",
    entity_id: id,
    after: { entity_name: "hiring_doc" },
  });

  revalidatePath("/app/hiring");
}
