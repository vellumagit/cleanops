"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InvoicingFormState = {
  errors?: Partial<Record<"_form" | "hour", string>>;
  success?: boolean;
  /** Existing drafts picked up and queued by turning auto-send on. */
  queued?: { count: number; sendAtIso: string };
};

/**
 * How far back to reach when auto-send is switched on. Drafts created while
 * it was OFF carry no schedule, so before this they sat inert forever and
 * the owner had no way to tell them apart from ones that would send.
 *
 * Bounded deliberately: an org with months of abandoned drafts would
 * otherwise mass-mail its entire back catalogue the instant someone flipped
 * a switch. A week covers "I just set this up" without reaching into
 * anything the owner has already moved on from.
 */
const BACKFILL_WINDOW_DAYS = 7;

export async function saveInvoiceAutoSendAction(
  _prev: InvoicingFormState,
  formData: FormData,
): Promise<InvoicingFormState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "You don't have permission." } };
  }

  const enabled = formData.get("enabled") === "on";
  const consolidated = formData.get("consolidated") === "on";
  // Parse strictly. Number("") is 0, which passes a 0-23 range check and
  // silently saves MIDNIGHT — so a select that submits nothing (unmatched
  // value, hydration hiccup) would quietly move every invoice to 12:00 AM.
  // Reject anything that isn't plainly a number instead.
  const rawHour = String(formData.get("send_hour") ?? "").trim();
  if (!/^\d{1,2}$/.test(rawHour)) {
    return { errors: { hour: "Pick a time of day." } };
  }
  const sendHour = Number(rawHour);
  if (sendHour < 0 || sendHour > 23) {
    return { errors: { hour: "Pick a time of day." } };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_hour: sendHour,
      invoice_auto_send_consolidated: consolidated,
    } as never)
    .eq("id", membership.organization_id);
  if (error) return { errors: { _form: error.message } };

  // Turning auto-send OFF stands down everything queued (→ held, resumable);
  // turning it ON queues everything waiting — including drafts created while
  // it was off.
  let queued: InvoicingFormState["queued"];
  if (enabled) {
    // Turning it ON queues everything waiting, at the NEXT send slot
    // (tomorrow at the configured hour) — never instantly. The owner keeps
    // the same review window and morning-digest heads-up as any fresh
    // draft; "flip a switch, a week of invoices blasts out this second"
    // is the one version of this that could go badly.
    const { computeAutoSendAt } = await import("@/lib/invoice-send");
    const { data: orgRow } = (await admin
      .from("organizations")
      .select("timezone")
      .eq("id", membership.organization_id)
      .maybeSingle()) as unknown as { data: { timezone: string | null } | null };
    const tz = orgRow?.timezone ?? null;
    const sendAtIso = computeAutoSendAt(new Date(), tz, sendHour).toISOString();

    // 1. Re-arm previously-held drafts — held only ever means "auto-send was
    // switched off while these were queued" or the owner's own Hold button,
    // and before this they stayed held forever (audit P8). No age cutoff:
    // held drafts were already in the pipeline once.
    const { data: rearmed } = (await admin
      .from("invoices")
      .update({ auto_send_state: "scheduled", auto_send_at: sendAtIso } as never)
      .eq("organization_id", membership.organization_id)
      .eq("auto_send_state" as never, "held" as never)
      .eq("status", "draft")
      .select("id")) as unknown as { data: Array<{ id: string }> | null };

    // 2. Sweep drafts created while auto-send was OFF. Those carry no
    // schedule at all (state NULL), so they previously sat inert forever,
    // indistinguishable from drafts that would send. Window-bounded, and $0
    // drafts are excluded — the cron would only flip them to "skipped",
    // which reads as an alarm for an invoice that shouldn't email anyway.
    const cutoffIso = new Date(
      Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: swept } = (await admin
      .from("invoices")
      .update({ auto_send_state: "scheduled", auto_send_at: sendAtIso } as never)
      .eq("organization_id", membership.organization_id)
      .is("auto_send_state" as never, null as never)
      .eq("status", "draft")
      .gte("created_at", cutoffIso)
      .gt("amount_cents", 0)
      .select("id")) as unknown as { data: Array<{ id: string }> | null };

    const count = (rearmed?.length ?? 0) + (swept?.length ?? 0);
    if (count > 0) queued = { count, sendAtIso };
  } else {
    await (admin
      .from("invoices")
      .update({ auto_send_state: "held", auto_send_at: null } as never)
      .eq("organization_id", membership.organization_id)
      .eq("auto_send_state" as never, "scheduled" as never) as unknown as Promise<unknown>);
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "settings",
    entity_id: membership.organization_id,
    after: {
      invoice_auto_send_enabled: enabled,
      invoice_auto_send_hour: sendHour,
      invoice_auto_send_consolidated: consolidated,
    },
  });

  revalidatePath("/app/settings/invoicing");
  // Both branches above mass-mutate invoices.auto_send_state / auto_send_at,
  // and those two columns are what the invoice list and detail pages render
  // their auto-send badge and countdown from. Without these the toggle looked
  // like it had done nothing until the cache expired — the same "my setting
  // didn't save" report that the settings form itself was already fixed for.
  revalidatePath("/app/invoices");
  revalidatePath("/app/invoices/[id]", "page");
  return { success: true, queued };
}
