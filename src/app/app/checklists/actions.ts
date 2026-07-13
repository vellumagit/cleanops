"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Read the repeated "items" field the editor posts. Each item is a JSON
 * string: { title, phase, is_required }.
 */
function readItemsFromForm(formData: FormData) {
  const raw = formData.getAll("items").map((v) => String(v));
  const parsed: Array<{
    title: string;
    phase: "pre" | "during" | "post";
    is_required: boolean;
  }> = [];
  for (const s of raw) {
    try {
      const j = JSON.parse(s);
      const title = String(j.title ?? "").trim();
      const phase =
        j.phase === "pre" || j.phase === "post" ? j.phase : "during";
      const is_required = Boolean(j.is_required);
      if (title) parsed.push({ title, phase, is_required });
    } catch {
      // ignore malformed rows
    }
  }
  return parsed;
}

export async function createChecklistTemplateAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const service_type = String(formData.get("applies_to_service_type") ?? "").trim();
  if (!name) return { ok: false, error: "Template name is required." };

  const items = readItemsFromForm(formData);

  const { data: tpl, error } = (await supabase
    .from("checklist_templates")
    .insert({
      organization_id: membership.organization_id,
      name,
      description: description || null,
      applies_to_service_type: service_type || null,
      is_active: true,
    })
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (error || !tpl) {
    return { ok: false, error: error?.message ?? "Could not create template." };
  }

  if (items.length > 0) {
    const rows = items.map((it, idx) => ({
      template_id: tpl.id,
      organization_id: membership.organization_id,
      ordinal: idx,
      title: it.title,
      phase: it.phase,
      is_required: it.is_required,
    }));
    await (supabase
      .from("checklist_template_items")
      .insert(rows) as unknown as Promise<unknown>);
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "training_module", // closest existing enum; bonus: audit_entity union doesn't include "checklist_template"
    entity_id: tpl.id,
    after: { name, item_count: items.length, checklist_template: true },
  });

  revalidatePath("/app/checklists");
  return { ok: true, id: tpl.id };
}

export async function updateChecklistTemplateAction(
  templateId: string,
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const service_type = String(formData.get("applies_to_service_type") ?? "").trim();
  if (!name) return { ok: false, error: "Template name is required." };

  const items = readItemsFromForm(formData);

  const { error: upErr } = (await supabase
    .from("checklist_templates")
    .update({
      name,
      description: description || null,
      applies_to_service_type: service_type || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .eq(
      "organization_id",
      membership.organization_id,
    )) as unknown as { error: { message: string } | null };
  if (upErr) return { ok: false, error: upErr.message };

  // Wipe + recreate items. Fine for small lists and simplifies reorder.
  await (supabase
    .from("checklist_template_items")
    .delete()
    .eq(
      "template_id",
      templateId,
    ) as unknown as Promise<unknown>);

  if (items.length > 0) {
    const rows = items.map((it, idx) => ({
      template_id: templateId,
      organization_id: membership.organization_id,
      ordinal: idx,
      title: it.title,
      phase: it.phase,
      is_required: it.is_required,
    }));
    await (supabase
      .from("checklist_template_items")
      .insert(rows) as unknown as Promise<unknown>);
  }

  revalidatePath("/app/checklists");
  revalidatePath(`/app/checklists/${templateId}`);
  return { ok: true, id: templateId };
}

export async function deleteChecklistTemplateAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  await (supabase
    .from("checklist_templates")
    .delete()
    .eq("id", id)
    .eq(
      "organization_id",
      membership.organization_id,
    ) as unknown as Promise<unknown>);

  revalidatePath("/app/checklists");
  redirect("/app/checklists");
}

/**
 * Attach a template to a booking — copies its items into booking_checklist_items.
 * If the booking already has items, this appends (doesn't replace), so you can
 * compose multiple templates on one job.
 */
export async function attachTemplateToBookingAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const template_id = String(formData.get("template_id") ?? "").trim();
  const booking_id = String(formData.get("booking_id") ?? "").trim();
  if (!template_id || !booking_id) {
    return { ok: false, error: "Missing template or booking id." };
  }

  const { data: items } = (await supabase
    .from("checklist_template_items")
    .select("ordinal, title, phase, is_required")
    .eq("template_id", template_id)
    .order("ordinal", {
      ascending: true,
    })) as unknown as {
    data: Array<{
      ordinal: number;
      title: string;
      phase: "pre" | "during" | "post";
      is_required: boolean;
    }> | null;
  };

  if (!items || items.length === 0) {
    return { ok: false, error: "Template has no items." };
  }

  // Find current max ordinal so appending keeps items in order.
  const { data: existing } = (await supabase
    .from("booking_checklist_items")
    .select("ordinal")
    .eq("booking_id", booking_id)
    .order("ordinal", { ascending: false })
    .limit(1)) as unknown as {
    data: Array<{ ordinal: number }> | null;
  };
  const base = (existing?.[0]?.ordinal ?? -1) + 1;

  const rows = items.map((it, idx) => ({
    organization_id: membership.organization_id,
    booking_id,
    source_template_id: template_id,
    ordinal: base + idx,
    title: it.title,
    phase: it.phase,
    is_required: it.is_required,
  }));

  const { error } = (await supabase
    .from("booking_checklist_items")
    .insert(rows)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/bookings/${booking_id}`);
  revalidatePath(`/app/bookings/${booking_id}/edit`);
  revalidatePath(`/field/jobs/${booking_id}`);
  return { ok: true };
}

/**
 * Make this template a CLIENT's default checklist. Every NEW booking for that
 * client then auto-gets the checklist (via the apply_client_checklist trigger),
 * and this backfills the client's already-scheduled upcoming bookings too — so
 * it shows on all of their jobs, existing and future.
 */
export async function assignChecklistToClientAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }
  const template_id = String(formData.get("template_id") ?? "").trim();
  const client_id = String(formData.get("client_id") ?? "").trim();
  if (!template_id || !client_id) {
    return { ok: false, error: "Pick a client to assign." };
  }

  const { error } = (await supabase
    .from("clients")
    .update({ default_checklist_template_id: template_id } as never)
    .eq("id", client_id)
    .eq("organization_id", membership.organization_id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // Backfill upcoming bookings that don't already have a checklist.
  await supabase.rpc("backfill_client_checklist" as never, {
    p_client: client_id,
    p_template: template_id,
  } as never);

  revalidatePath(`/app/checklists/${template_id}`);
  revalidatePath(`/app/clients/${client_id}`);
  return { ok: true };
}

/**
 * Remove this template as a client's default checklist. Only clears the link if
 * it currently points at THIS template (so it can't clobber a different
 * assignment), and leaves already-attached booking checklists untouched.
 */
export async function unassignChecklistFromClientAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }
  const template_id = String(formData.get("template_id") ?? "").trim();
  const client_id = String(formData.get("client_id") ?? "").trim();
  if (!client_id) return { ok: false, error: "Missing client." };

  const { error } = (await supabase
    .from("clients")
    .update({ default_checklist_template_id: null } as never)
    .eq("id", client_id)
    .eq("organization_id", membership.organization_id)
    .eq("default_checklist_template_id" as never, template_id as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/checklists/${template_id}`);
  revalidatePath(`/app/clients/${client_id}`);
  return { ok: true };
}

/**
 * Toggle a single checklist item's checked state. Used by both the admin
 * side and the field app. Setting checked=true stamps checked_at + _by;
 * setting false clears both.
 */
export async function toggleChecklistItemAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();

  const id = String(formData.get("id") ?? "").trim();
  const checked = formData.get("checked") === "1";
  if (!id) return { ok: false, error: "Missing item id." };

  const { error } = (await supabase
    .from("booking_checklist_items")
    .update({
      checked_at: checked ? new Date().toISOString() : null,
      checked_by: checked ? membership.id : null,
    })
    .eq("id", id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  revalidatePath("/field/jobs");
  return { ok: true };
}

export async function removeChecklistItemAction(
  formData: FormData,
): Promise<Result> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const booking_id = String(formData.get("booking_id") ?? "").trim();
  if (!id) return { ok: false, error: "Missing item id." };

  const { error } = (await supabase
    .from("booking_checklist_items")
    .delete()
    .eq("id", id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  if (booking_id) {
    revalidatePath(`/app/bookings/${booking_id}`);
    revalidatePath(`/field/jobs/${booking_id}`);
  }
  return { ok: true };
}
