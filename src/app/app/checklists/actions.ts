"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Revoking a template retracts its copies from work that hasn't started.
 *
 * Copies exist so template edits never rewrite what a cleaner actually
 * checked on a finished job — but Brian deleted a template and watched its
 * items keep sitting on tomorrow's booking next to the replacement's
 * (the FK just went null and the rows stayed). Frozen history is for
 * history: past, in-progress, and completed jobs keep their copy;
 * untouched upcoming ones give it back.
 *
 * Runs BEFORE the template row is deleted — after that the FK is null and
 * the copies can no longer be told apart from any other orphan.
 */
const UNSTARTED_STATUSES = ["pending", "confirmed", "en_route"] as const;
async function sweepUpcomingTemplateCopies(
  orgId: string,
  templateId: string,
  scope: { clientId?: string; serviceTypeId?: string } = {},
): Promise<void> {
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("bookings")
    .select("id")
    .eq("organization_id", orgId)
    .gte("scheduled_at", new Date().toISOString())
    .in("status", UNSTARTED_STATUSES);
  if (scope.clientId) q = q.eq("client_id", scope.clientId);
  if (scope.serviceTypeId) {
    q = q.eq("service_type_id" as never, scope.serviceTypeId as never);
  }
  const { data } = (await q) as unknown as {
    data: Array<{ id: string }> | null;
  };
  const ids = (data ?? []).map((b) => b.id);
  for (let i = 0; i < ids.length; i += 200) {
    await (admin
      .from("booking_checklist_items")
      .delete()
      .eq("source_template_id", templateId)
      .in("booking_id", ids.slice(i, i + 200)) as unknown as Promise<unknown>);
  }
}

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

/**
 * The auto-attach target must be one of THIS org's services — the id comes
 * from a browser select, so it's proved before it's written. A bad id
 * degrades to null (manual-only) rather than failing the save.
 */
async function readServiceTypeId(
  supabase: Awaited<ReturnType<typeof getActionContext>>["supabase"],
  orgId: string,
  formData: FormData,
): Promise<string | null> {
  const raw = String(formData.get("applies_to_service_type_id") ?? "").trim();
  if (!raw) return null;
  const { data } = (await supabase
    .from("service_types" as never)
    .select("id")
    .eq("id" as never, raw as never)
    .eq("organization_id" as never, orgId as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  return data ? raw : null;
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
  const service_type_id = await readServiceTypeId(
    supabase,
    membership.organization_id,
    formData,
  );
  if (!name) return { ok: false, error: "Template name is required." };

  const items = readItemsFromForm(formData);

  const { data: tpl, error } = (await supabase
    .from("checklist_templates")
    .insert({
      organization_id: membership.organization_id,
      name,
      description: description || null,
      applies_to_service_type_id: service_type_id,
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

  // Occurrences are generated up to a year ahead — without this, a new
  // service checklist wouldn't appear on any recurring job for months.
  // Admin client on purpose: the backfill functions are being locked to
  // service_role so no logged-in user can invoke them with a foreign
  // template id.
  if (service_type_id) {
    await createSupabaseAdminClient().rpc("backfill_service_checklist" as never, {
      p_template: tpl.id,
    } as never);
  }

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
  const service_type_id = await readServiceTypeId(
    supabase,
    membership.organization_id,
    formData,
  );
  if (!name) return { ok: false, error: "Template name is required." };

  const items = readItemsFromForm(formData);

  // Detect an auto-attach retarget: pointing the template away from a
  // service should take its items back off that service's unstarted
  // bookings, the same way deleting the template would.
  const { data: before } = (await supabase
    .from("checklist_templates")
    .select("applies_to_service_type_id")
    .eq("id", templateId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: { applies_to_service_type_id: string | null } | null;
  };

  const { error: upErr } = (await supabase
    .from("checklist_templates")
    .update({
      name,
      description: description || null,
      applies_to_service_type_id: service_type_id,
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

  // Auto-attach moved off a service (cleared, or switched to another) —
  // retract from the OLD service's unstarted bookings. Scoped to that
  // service so hand- and client-attached copies elsewhere survive.
  const previousServiceId = before?.applies_to_service_type_id ?? null;
  if (previousServiceId && previousServiceId !== service_type_id) {
    await sweepUpcomingTemplateCopies(membership.organization_id, templateId, {
      serviceTypeId: previousServiceId,
    });
  }

  // Sweep-then-backfill the CURRENT service so unstarted future bookings
  // reflect the items the owner just saved — otherwise an edited template
  // never reached tomorrow's booking (the backfill guard skips bookings
  // already carrying it). Frozen copies remain the rule only where
  // checking has meaning: past, in-progress, and completed jobs.
  if (service_type_id) {
    await sweepUpcomingTemplateCopies(membership.organization_id, templateId, {
      serviceTypeId: service_type_id,
    });
    await createSupabaseAdminClient().rpc("backfill_service_checklist" as never, {
      p_template: templateId,
    } as never);
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

  // Retract from unstarted future work first — see sweepUpcomingTemplateCopies.
  await sweepUpcomingTemplateCopies(membership.organization_id, id);

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

  // The template id arrives from a browser — prove it's THIS org's before
  // it becomes a client default and the admin-client backfill copies its
  // items into this org's bookings.
  const { data: ownTemplate } = (await supabase
    .from("checklist_templates")
    .select("id")
    .eq("id", template_id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as { data: { id: string } | null };
  if (!ownTemplate) return { ok: false, error: "Template not found." };

  const { error } = (await supabase
    .from("clients")
    .update({ default_checklist_template_id: template_id } as never)
    .eq("id", client_id)
    .eq("organization_id", membership.organization_id)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };

  // Backfill upcoming bookings that don't already have a checklist.
  // Admin client — see the service backfill call for why.
  await createSupabaseAdminClient().rpc("backfill_client_checklist" as never, {
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

  // Assigning backfills the client's upcoming bookings; unassigning takes
  // them back — only theirs, and only jobs that haven't started.
  if (template_id) {
    await sweepUpcomingTemplateCopies(membership.organization_id, template_id, {
      clientId: client_id,
    });
  }

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
