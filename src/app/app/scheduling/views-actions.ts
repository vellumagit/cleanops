"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

export type SchedulerViewRow = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  sort_order: number;
};

export type SaveViewResult = {
  error?: string;
  ok?: boolean;
  view?: SchedulerViewRow;
};

/**
 * Save a scheduler view. On insert: creates a new row. On update
 * (when `id` is provided): updates the existing one. Only owners /
 * admins / managers can write — the RLS policy enforces this, but
 * we also role-gate here so we can return a friendly message instead
 * of a cryptic DB error.
 */
export async function saveSchedulerViewAction(args: {
  id?: string;
  name: string;
  filters: Record<string, unknown>;
}): Promise<SaveViewResult> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return {
      error: "Only owners, admins, or managers can save shared views.",
    };
  }

  const name = args.name.trim();
  if (!name) return { error: "Pick a name for this view." };
  if (name.length > 80)
    return { error: "Name is too long — keep it under 80 characters." };

  const admin = createSupabaseAdminClient();

  if (args.id) {
    const { data, error } = (await admin
      .from("scheduler_views" as never)
      .update({ name, filters: args.filters } as never)
      .eq("id" as never, args.id as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )
      .select("id, name, filters, sort_order")
      .maybeSingle()) as unknown as {
      data: SchedulerViewRow | null;
      error: { message: string } | null;
    };
    if (error) return { error: error.message };
    if (!data) return { error: "View not found." };
    revalidatePath("/app/scheduling");
    return { ok: true, view: data };
  }

  // Insert — pick a sort_order one past the current max for a
  // deterministic "new views go to the bottom" default.
  const { data: maxRow } = (await admin
    .from("scheduler_views" as never)
    .select("sort_order")
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    )
    .order("sort_order" as never, { ascending: false } as never)
    .limit(1)
    .maybeSingle()) as unknown as {
    data: { sort_order: number } | null;
  };
  const sort_order = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = (await admin
    .from("scheduler_views" as never)
    .insert({
      organization_id: membership.organization_id,
      name,
      filters: args.filters,
      sort_order,
      created_by: membership.id,
    } as never)
    .select("id, name, filters, sort_order")
    .single()) as unknown as {
    data: SchedulerViewRow | null;
    error: { message: string; code?: string } | null;
  };

  if (error) {
    // Unique violation on (org_id, name) — surface a readable message.
    if (error.code === "23505") {
      return {
        error:
          "A view with that name already exists. Pick a different name or update the existing one.",
      };
    }
    return { error: error.message };
  }
  if (!data) return { error: "Could not save the view." };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "settings",
    entity_id: data.id,
    after: { scheduler_view_name: name },
  });

  revalidatePath("/app/scheduling");
  return { ok: true, view: data };
}

export async function deleteSchedulerViewAction(
  id: string,
): Promise<{ error?: string; ok?: boolean }> {
  const { membership } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Only owners, admins, or managers can delete views." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("scheduler_views" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq(
      "organization_id" as never,
      membership.organization_id as never,
    );
  if (error) return { error: error.message };

  revalidatePath("/app/scheduling");
  return { ok: true };
}
