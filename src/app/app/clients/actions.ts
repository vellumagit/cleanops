"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { logAuditEvent } from "@/lib/audit";
import { ClientSchema } from "@/lib/validators/clients";
import { redirectAfterSetup } from "@/lib/setup-return";
import { normalizePhone } from "@/lib/phone";
import { notify } from "@/lib/notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Generate a URL-safe token for the GBP redirect / unsubscribe links.
 * Matches the entropy used by the cron's lazy mint (24 chars from
 * base64url-encoded random bytes) so links from a "Reset" look
 * indistinguishable from cron-minted ones.
 */
function randomTokenSafe(): string {
  return randomBytes(18).toString("base64url").slice(0, 24);
}

type Field = keyof typeof ClientSchema.shape;
export type ClientFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    // Normalise to E.164 on the way in — Twilio requires this format and
    // the opt-in gate in sendOrgSms matches by stored phone number.
    phone: normalizePhone(String(formData.get("phone") ?? "")),
    address: String(formData.get("address") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    preferred_contact: String(formData.get("preferred_contact") ?? "email"),
    preferred_cleaner_id: String(formData.get("preferred_cleaner_id") ?? ""),
    billing_cadence: String(formData.get("billing_cadence") ?? "on_demand"),
    billing_type: String(formData.get("billing_type") ?? "itemized"),
    referred_by_client_id: String(formData.get("referred_by_client_id") ?? ""),
    // Form input is in dollars (user-facing); convert to cents for storage.
    flat_rate_cents: (() => {
      const raw = String(formData.get("flat_rate_cents") ?? "").trim();
      if (!raw) return "";
      const dollars = parseFloat(raw);
      if (isNaN(dollars) || dollars < 0) return "";
      return String(Math.round(dollars * 100));
    })(),
  };
}

/**
 * Insert a persistent "say thank you" notification when a referral is recorded.
 * Runs fire-and-forget — a delivery failure must never block the client save.
 * Uses the admin client because notifications INSERT is service-role-only.
 */
async function notifyReferralThankYou(
  organizationId: string,
  referrerId: string,
  newClientName: string,
) {
  try {
    const admin = createSupabaseAdminClient();

    // Resolve the referrer's display name.
    const { data: referrer } = (await admin
      .from("clients")
      .select("name")
      .eq("id", referrerId)
      .eq("organization_id" as never, organizationId as never)
      .maybeSingle()) as unknown as { data: { name: string } | null };

    const referrerName = referrer?.name ?? "the referring client";

    // Owner/admin only — referral/CRM content, not for cleaners. (The old
    // null-recipient row was readable by any member via direct query.)
    await notify({
      audience: "org-admins",
      organizationId,
      title: `Say thank you to ${referrerName}!`,
      body: `${newClientName} was referred by ${referrerName}. A quick thank-you message goes a long way.`,
      href: `/app/clients/${referrerId}`,
    });
  } catch {
    // Non-critical — log silently and let the client save succeed.
    console.error("[referral] Failed to insert thank-you notification");
  }
}

export async function createClientAction(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // Checkbox sends "on" when checked, nothing when unchecked.
  const smsOptedIn = formData.get("sms_opted_in") === "on";
  // "I've already reviewed this business" checkbox — pre-marks the
  // client so the Google review cron never asks them. Audit marker
  // (gbp_marked_reviewed_at_creation) preserves the distinction
  // between "owner said this at creation" and "owner clicked
  // 'mark reviewed' later".
  const gbpAlreadyReviewed = formData.get("gbp_already_reviewed") === "on";

  const { data: inserted, error } = (await supabase
    .from("clients")
    .insert({
      organization_id: membership.organization_id,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      preferred_cleaner_id: parsed.data.preferred_cleaner_id ?? null,
      sms_opted_in: smsOptedIn,
      billing_cadence: parsed.data.billing_cadence,
      billing_type: parsed.data.billing_type,
      flat_rate_cents: parsed.data.flat_rate_cents ?? null,
      referred_by_client_id: parsed.data.referred_by_client_id ?? null,
      ...(gbpAlreadyReviewed
        ? {
            gbp_review_state: "reviewed",
            gbp_marked_reviewed_at_creation: true,
          }
        : {}),
    } as never)
    .select("id")
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    return { errors: { _form: error?.message ?? "Insert failed" }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "create",
    entity: "client",
    entity_id: inserted.id,
    after: { name: parsed.data.name, email: parsed.data.email ?? null },
  });

  // Fire-and-forget: remind the org to thank the referring client.
  if (parsed.data.referred_by_client_id) {
    notifyReferralThankYou(
      membership.organization_id,
      parsed.data.referred_by_client_id,
      parsed.data.name,
    );
  }

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirectAfterSetup(formData, "/app/clients");
}

export async function updateClientAction(
  id: string,
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ClientSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();

  // A client cannot refer themselves — catch both crafted form POSTs and
  // UI bugs before they create a circular self-referral in the DB.
  if (parsed.data.referred_by_client_id && parsed.data.referred_by_client_id === id) {
    return { errors: { _form: "A client cannot be their own referrer." }, values: raw };
  }

  const { data: previous } = (await supabase
    .from("clients")
    .select(
      "name, email, phone, address, notes, preferred_contact, preferred_cleaner_id, referred_by_client_id",
    )
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      notes: string | null;
      preferred_contact: string;
      preferred_cleaner_id: string | null;
      referred_by_client_id: string | null;
    } | null;
  };

  const smsOptedIn = formData.get("sms_opted_in") === "on";

  const { error } = await (supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      preferred_cleaner_id: parsed.data.preferred_cleaner_id ?? null,
      sms_opted_in: smsOptedIn,
      billing_cadence: parsed.data.billing_cadence,
      billing_type: parsed.data.billing_type,
      flat_rate_cents: parsed.data.flat_rate_cents ?? null,
      referred_by_client_id: parsed.data.referred_by_client_id ?? null,
    } as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<{ error: { message: string } | null }>);

  if (error) {
    return { errors: { _form: error.message }, values: raw };
  }

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
    after: {
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
      preferred_contact: parsed.data.preferred_contact,
      sms_opted_in: smsOptedIn,
    },
  });

  // Fire-and-forget: notify only when a referrer is newly added or swapped.
  const newReferrerId = parsed.data.referred_by_client_id ?? null;
  const oldReferrerId = previous?.referred_by_client_id ?? null;
  if (newReferrerId && newReferrerId !== oldReferrerId) {
    notifyReferralThankYou(
      membership.organization_id,
      newReferrerId,
      parsed.data.name,
    );
  }

  revalidatePath("/app/clients");
  revalidatePath(`/app/clients/${id}/edit`);
  revalidatePath("/app");
  redirect("/app/clients");
}

export async function deleteClientAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();

  // Capture the FULL row before delete so the audit log can reconstruct
  // the client if it's deleted by accident. Previously only name+email
  // were stored, leaving phone, address, balance, billing config,
  // preferred_cleaner_id, notes, and contact preferences unrecoverable.
  const { data: previous } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle();

  const { error } = await supabase.from("clients").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "client",
    entity_id: id,
    before: previous ?? null,
  });

  revalidatePath("/app/clients");
  revalidatePath("/app");
  redirect("/app/clients");
}

// ---------------------------------------------------------------------------
// Google review state — manual overrides (owner / admin / manager)
// ---------------------------------------------------------------------------
//
// These run from the client detail page when the owner wants to nudge,
// silence, or reset the GBP review cron's behavior for a specific
// customer. Each is idempotent — clicking twice on the same button
// produces the same end state.

type GbpAction = "mark_reviewed" | "opt_out" | "reset" | "force_resend";

async function setGbpState(id: string, action: GbpAction): Promise<void> {
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) return;

  // Pull existing tokens + the preconditions we need to validate
  // reset / force_resend in one round trip. RLS scopes by org.
  const { data: existingRow } = (await supabase
    .from("clients")
    .select(
      "gbp_redirect_token, gbp_unsubscribe_token, gbp_review_state, email, organization:organizations ( google_review_url )",
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      gbp_redirect_token: string | null;
      gbp_unsubscribe_token: string | null;
      gbp_review_state: string;
      email: string | null;
      organization: { google_review_url: string | null } | null;
    } | null;
  };

  if (!existingRow) return; // client not found / not in org

  // ── Precondition checks ─────────────────────────────────────────
  // reset + force_resend flip state to "pending" which means the cron
  // WILL pick this client up on the next run. The cron requires both
  // a client email AND the org's google_review_url. Without either,
  // the cron silently skips and the owner sits there confused why no
  // email goes out. Refuse server-side and log so the case is
  // discoverable. The UI also disables the corresponding buttons when
  // preconditions aren't met (defense-in-depth).
  if (action === "reset" || action === "force_resend") {
    const missing: string[] = [];
    if (!existingRow.email) missing.push("client email");
    if (!existingRow.organization?.google_review_url) {
      missing.push("organization's Google review URL (Settings → Branding)");
    }
    if (missing.length > 0) {
      console.warn(
        `[gbp/${action}] precondition failed for client ${id}: missing ${missing.join(", ")}`,
      );
      revalidatePath(`/app/clients/${id}`);
      return;
    }
  }

  // ── Compute the patch ──────────────────────────────────────────
  // All paths also reset the reminder cycle so re-enabling a lapsed
  // customer feels like a fresh start.
  const nowIso = new Date().toISOString();
  let patch: Record<string, unknown> = {};
  // Optional WHERE-clause guard so the UPDATE is atomic. Force-resend
  // gates on "pending" only (lapsed customers should use Reset which
  // mints fresh tokens + clears all the timestamps). Other actions
  // don't gate.
  let stateGuard: string | null = null;

  switch (action) {
    case "mark_reviewed":
      patch = { gbp_review_state: "reviewed", gbp_next_reminder_at: null };
      break;
    case "opt_out":
      patch = {
        gbp_review_state: "opted_out",
        gbp_unsubscribed_at: nowIso,
        gbp_next_reminder_at: null,
      };
      break;
    case "reset":
      // Bring the customer BACK into the asking rotation.
      //
      // We DON'T flip to never_asked because the initial-ask cron
      // phase only looks at bookings 24h-14d old — a 6-month
      // customer has no qualifying "first job" and would silently
      // never get picked up again.
      //
      // Instead we flip directly to pending with tokens minted (if
      // missing) and the next reminder scheduled for "now", so the
      // very next daily cron run treats them as a reminder candidate
      // (the cron's reminder branch doesn't gate on booking recency).
      // Reminder counter resets so the cap is honored from scratch.
      {
        const newRedirect =
          existingRow?.gbp_redirect_token ?? randomTokenSafe();
        const newUnsub =
          existingRow?.gbp_unsubscribe_token ?? randomTokenSafe();
        patch = {
          gbp_review_state: "pending",
          gbp_first_asked_at: nowIso,
          gbp_last_asked_at: null,
          gbp_next_reminder_at: nowIso,
          gbp_reminders_sent: 0,
          gbp_clicked_at: null,
          gbp_unsubscribed_at: null,
          gbp_redirect_token: newRedirect,
          gbp_unsubscribe_token: newUnsub,
        };
      }
      break;
    case "force_resend":
      // Schedule an immediate retry on the daily cron AND reset the
      // reminder counter so a previously-lapsed customer (at the cap)
      // doesn't immediately re-lapse without an email going out.
      //
      // State CAS guard: only valid from pending. The UI gates the
      // button on this too, but a CSRF / multi-tab race could POST
      // from a `reviewed` or `clicked` UI; this WHERE clause makes
      // sure we can't accidentally resurrect them.
      patch = {
        gbp_review_state: "pending",
        gbp_next_reminder_at: nowIso,
        gbp_reminders_sent: 0,
      };
      stateGuard = "pending";
      break;
  }

  // ── Apply ──────────────────────────────────────────────────────
  let updateQuery = supabase
    .from("clients")
    .update(patch as never)
    .eq("id", id)
    .eq("organization_id" as never, membership.organization_id as never);
  if (stateGuard) {
    updateQuery = updateQuery.eq(
      "gbp_review_state" as never,
      stateGuard as never,
    );
  }
  await updateQuery;

  await logAuditEvent({
    membership,
    action: "update",
    entity: "client",
    entity_id: id,
    after: { gbp_action: action },
  });

  revalidatePath(`/app/clients/${id}`);
}

export async function markGbpReviewedAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await setGbpState(id, "mark_reviewed");
}

export async function optOutGbpAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await setGbpState(id, "opt_out");
}

export async function resetGbpAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await setGbpState(id, "reset");
}

export async function forceResendGbpAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) await setGbpState(id, "force_resend");
}
