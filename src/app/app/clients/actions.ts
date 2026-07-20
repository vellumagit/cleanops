"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { canCreateData } from "@/lib/subscription";
import { logAuditEvent } from "@/lib/audit";
import { ClientSchema } from "@/lib/validators/clients";
import { redirectAfterSetup } from "@/lib/setup-return";
import { normalizePhone } from "@/lib/phone";
import { notify } from "@/lib/notify";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  updateCalendarEvent,
  syncMemberCalendarEvents,
} from "@/lib/google-calendar";

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

  if (!(await canCreateData(membership.organization_id))) {
    return { errors: { _form: "Your subscription has expired. Subscribe to add new clients." }, values: raw };
  }

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
      // CASL consent audit stamp — recorded the moment consent is captured.
      ...(smsOptedIn
        ? {
            sms_opted_in_at: new Date().toISOString(),
            sms_opt_in_source: "client_form",
          }
        : {}),
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
      "name, email, phone, address, notes, preferred_contact, preferred_cleaner_id, referred_by_client_id, sms_opted_in",
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
      sms_opted_in: boolean;
    } | null;
  };

  const smsOptedIn = formData.get("sms_opted_in") === "on";

  // CASL consent audit stamp. Stamp on a false→true transition; clear on
  // opt-out; leave an existing timestamp untouched on an unrelated edit.
  const wasOptedIn = Boolean(previous?.sms_opted_in);
  const consentPatch =
    smsOptedIn && !wasOptedIn
      ? { sms_opted_in_at: new Date().toISOString(), sms_opt_in_source: "client_form" }
      : !smsOptedIn
        ? { sms_opted_in_at: null, sms_opt_in_source: null }
        : {};

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
      ...consentPatch,
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

  // If the client's NAME changed, the client's name is baked into every
  // booking's Google Calendar event title ("{service} — {name}"), so those
  // events still show the old name until re-synced. Re-push the calendar events
  // for this client's upcoming bookings with the new name. Awaited (a server
  // action's un-awaited work can be cut off after the redirect); best-effort
  // per booking — the reconcile crons self-heal anything that slips through.
  if (previous && previous.name !== parsed.data.name) {
    const now = new Date().toISOString();
    const { data: upcoming } = (await supabase
      .from("bookings")
      .select(
        "id, google_calendar_event_id, scheduled_at, duration_minutes, service_type, address, notes",
      )
      .eq("client_id", id)
      .eq("organization_id", membership.organization_id)
      .in("status", ["confirmed", "in_progress"])
      .gte("scheduled_at", now)) as unknown as {
      data: Array<{
        id: string;
        google_calendar_event_id: string | null;
        scheduled_at: string;
        duration_minutes: number;
        service_type: string;
        address: string | null;
        notes: string | null;
      }> | null;
    };

    await Promise.all(
      (upcoming ?? []).map(async (b) => {
        const bookingObj = {
          id: b.id,
          scheduled_at: b.scheduled_at,
          duration_minutes: b.duration_minutes,
          service_type: b.service_type,
          address: b.address,
          notes: b.notes,
          client_name: parsed.data.name,
        };
        // Org calendar event.
        if (b.google_calendar_event_id) {
          await updateCalendarEvent(membership.organization_id, {
            ...bookingObj,
            google_calendar_event_id: b.google_calendar_event_id,
          }).catch((e) =>
            console.error("[gcal] client-rename org resync failed:", e),
          );
        }
        // Each assigned member's personal calendar.
        const { data: assignees } = (await supabase
          .from("booking_assignees")
          .select("membership_id")
          .eq("booking_id", b.id)) as unknown as {
          data: Array<{ membership_id: string }> | null;
        };
        await syncMemberCalendarEvents(
          b.id,
          (assignees ?? []).map((a) => a.membership_id),
          bookingObj,
        ).catch((e) =>
          console.error("[gcal/member] client-rename resync failed:", e),
        );
      }),
    );
  }

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

/**
 * Send a double opt-in SMS request to a client — the compliant consent flow.
 * The client must reply YES (handled by /api/sms/inbound, which flips
 * sms_opted_in true) to actually opt in. This only sends the ask and stamps the
 * pending state; it does NOT itself grant consent.
 */
export async function requestSmsOptInAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!clientId) return { ok: false, error: "Missing client." };

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const { data: client } = (await supabase
    .from("clients")
    .select("id, name, phone, sms_opted_in")
    .eq("id", clientId)
    .eq("organization_id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      phone: string | null;
      sms_opted_in: boolean;
    } | null;
  };
  if (!client) return { ok: false, error: "Client not found." };
  if (!client.phone) {
    return { ok: false, error: "Add a phone number to this client first." };
  }
  if (client.sms_opted_in) {
    return { ok: false, error: "This client has already opted in to texts." };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.organization_id)
    .maybeSingle();

  const { composeSmsOptInRequest } = await import("@/lib/twilio");
  const { sendOrgSms } = await import("@/lib/sms");
  const res = await sendOrgSms(membership.organization_id, {
    to: client.phone,
    body: composeSmsOptInRequest({
      orgName: (org as { name?: string } | null)?.name ?? "Sollos",
    }),
    automationKey: "sms_opt_in_request",
  });

  if (!res.ok) {
    return { ok: false, error: "Couldn't send the request — check the phone number." };
  }
  if (res.status !== "sent") {
    return {
      ok: false,
      error:
        "SMS isn't active for your org yet — enable SMS in Settings, and make sure it isn't paused.",
    };
  }

  const admin = createSupabaseAdminClient();
  await admin
    .from("clients")
    .update({ sms_opt_in_requested_at: new Date().toISOString() } as never)
    .eq("id", clientId);

  revalidatePath(`/app/clients/${clientId}`);
  return { ok: true };
}
