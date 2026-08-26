"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { can } from "@/lib/auth";
import { canCreateData } from "@/lib/subscription";
import { logAuditEvent } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import {
  parseQuickAdd,
  parseLeadStage,
  newLeadPatch,
  conversionPatch,
  lostPatch,
  canSetStage,
  type LeadStage,
} from "@/lib/lead-pipeline";

export type LeadFormState = {
  error?: string;
  success?: string;
  /** Set by updateLeadAction on success — the edit dialog closes on it. */
  savedAt?: number;
  /**
   * The new lead's id. Carried back purely so the form can key off something
   * UNIQUE to clear itself — the success message isn't, and adding two leads
   * called "Dana" in a row would otherwise leave the second form full.
   */
  addedId?: string;
};

/**
 * Leads are client records, so they answer to the clients capability rather
 * than a new one of their own — someone trusted with the client list is
 * trusted with the people trying to join it.
 */
async function guard() {
  const ctx = await getActionContext();
  if (!["owner", "admin", "manager"].includes(ctx.membership.role)) {
    return { ok: false as const, error: "You don't have permission." };
  }
  if (!can(ctx.membership, "clients")) {
    return {
      ok: false as const,
      error: "Client records aren't part of your access.",
    };
  }
  return { ok: true as const, ctx };
}

/**
 * Add a lead by hand.
 *
 * The most important function in the feature, and the least clever. Phone and
 * email inquiries can only ever be typed in, so this asks for a name and
 * nothing else. Every extra required field is a reason to write it on paper
 * instead, and a leads list nobody fills in is worse than no leads list — it
 * looks like the pipeline while missing most of it.
 */
export async function addLeadAction(
  _prev: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const g = await guard();
  if (!g.ok) return { error: g.error };
  const { membership, supabase } = g.ctx;

  const parsed = parseQuickAdd({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    note: formData.get("note"),
    source: formData.get("source"),
  });
  if (!parsed.ok) return { error: parsed.error };

  if (!(await canCreateData(membership.organization_id))) {
    return { error: "Your subscription has expired." };
  }

  const { name, phone, email, lead_note, lead_source } = parsed.value;

  const { data: inserted, error } = (await supabase
    .from("clients")
    .insert({
      organization_id: membership.organization_id,
      name,
      // Same normalization clients get, so a lead who converts already has a
      // phone number the SMS layer can use without a cleanup pass.
      phone: phone ? normalizePhone(phone) : null,
      email,
      lead_note,
      ...newLeadPatch(lead_source),
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error) return { error: error.message };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: inserted?.id ?? membership.organization_id,
    after: { name, lead_source, lifecycle: "lead" },
  });

  revalidatePath("/app/leads");
  return { success: `${name} added.`, addedId: inserted?.id };
}

/** Move a lead along (or back) in the pipeline. */
export async function setLeadStageAction(formData: FormData): Promise<void> {
  const g = await guard();
  if (!g.ok) return;
  const { membership, supabase } = g.ctx;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const stage: LeadStage = parseLeadStage(formData.get("stage"));

  // Read lifecycle first: stage means nothing on someone already won or lost,
  // and writing it anyway would leave a client carrying a pipeline position.
  const { data: row } = (await supabase
    .from("clients")
    .select("lifecycle")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: { lifecycle: string } | null };
  if (!row || !canSetStage(row.lifecycle)) return;

  await (supabase
    .from("clients")
    .update({ lead_stage: stage } as never)
    .eq("id", id) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    after: { lead_stage: stage },
  });

  revalidatePath("/app/leads");
}

/**
 * They said yes.
 *
 * One column flip and the stage cleared — no rows copied, nothing re-parented.
 * Any estimate, note or property already attached to them simply carries over,
 * which is the entire reason lifecycle is a column on clients rather than a
 * separate leads table.
 */
export async function convertLeadAction(formData: FormData): Promise<void> {
  const g = await guard();
  if (!g.ok) return;
  const { membership, supabase } = g.ctx;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  // Guarded on lifecycle so a double-click can't "convert" someone twice and
  // write a second audit entry claiming a close that already happened.
  const { data: updated } = (await supabase
    .from("clients")
    .update(conversionPatch() as never)
    .eq("id", id)
    .eq("lifecycle" as never, "lead" as never)
    .select("id, name")) as unknown as {
    data: Array<{ id: string; name: string }> | null;
  };

  if (!updated || updated.length === 0) return;

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    after: { lifecycle: "client", converted_from_lead: true },
  });

  // Their inquiry is answered by definition — they're a client now.
  const { resolveOpenClientRequests } = await import("@/lib/lead-conversion");
  await resolveOpenClientRequests(id);

  revalidatePath("/app/leads");
  revalidatePath("/app/clients");
}

/** They went elsewhere. Kept, not deleted — a lost lead is worth knowing about. */
/**
 * Quick-edit a lead in place — the dialog on the leads page. Four fields
 * and the note; scoped to lifecycle=lead so it can never rewrite a real
 * client from this surface. Clients get edited in the clients section;
 * leads get edited here. They are not the same thing.
 */
export async function updateLeadAction(
  _prev: LeadFormState,
  formData: FormData,
): Promise<LeadFormState> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { error: "Not authorized." };
  }
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  if (!id || !name) return { error: "A name is required." };
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40) || null;
  const email = String(formData.get("email") ?? "").trim().slice(0, 320) || null;
  const address =
    String(formData.get("address") ?? "").trim().slice(0, 300) || null;
  const lead_note =
    String(formData.get("lead_note") ?? "").trim().slice(0, 4000) || null;

  const { data: updated, error } = await supabase
    .from("clients")
    .update({ name, phone, email, address, lead_note } as never)
    .eq("id", id)
    .eq("organization_id", membership.organization_id)
    .eq("lifecycle" as never, "lead" as never)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "This lead no longer exists (it may have been converted)." };
  }

  revalidatePath("/app/leads");
  return { savedAt: Date.now() };
}

export async function markLeadLostAction(formData: FormData): Promise<void> {
  const g = await guard();
  if (!g.ok) return;
  const { membership, supabase } = g.ctx;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await (supabase
    .from("clients")
    .update(lostPatch() as never)
    .eq("id", id)
    .eq("lifecycle" as never, "lead" as never) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    after: { lifecycle: "lost" },
  });

  // Lost is also an answer — their open requests leave the inbox with them.
  {
    const { resolveOpenClientRequests } = await import("@/lib/lead-conversion");
    await resolveOpenClientRequests(String(formData.get("id") ?? ""));
  }

  revalidatePath("/app/leads");
}

/** Put a lost lead back in play — they called again. */
export async function reopenLeadAction(formData: FormData): Promise<void> {
  const g = await guard();
  if (!g.ok) return;
  const { membership, supabase } = g.ctx;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await (supabase
    .from("clients")
    .update({ lifecycle: "lead", lead_stage: "contacted" } as never)
    .eq("id", id)
    .eq("lifecycle" as never, "lost" as never) as unknown as Promise<unknown>);

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    after: { lifecycle: "lead", reopened: true },
  });

  revalidatePath("/app/leads");
}
