"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cookies } from "next/headers";
import {
  getActionContext,
  parseForm,
  type ActionState,
} from "@/lib/actions";
import { ProfileSchema } from "@/lib/validators/profile";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildGoogleOAuthUrl,
  bulkSyncMemberBookings,
  cleanupMemberCalendarEvents,
} from "@/lib/google-calendar";

type Field = keyof typeof ProfileSchema.shape;
export type ProfileFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  };
}

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ProfileSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone ?? null,
    })
    .eq("id", membership.profile_id);

  if (error) return { errors: { _form: error.message }, values: raw };

  revalidatePath("/field/profile");
  revalidatePath("/field");
  revalidatePath("/app");
  return { values: raw };
}

// ---------------------------------------------------------------------------
// Personal Google Calendar scope + highlight color
// ---------------------------------------------------------------------------

export type CalendarScopeState = { ok?: boolean; error?: string };
const VALID_COLOR_IDS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);

/**
 * Set whether the member's personal Google Calendar shows only their own jobs
 * ('mine') or the whole org ('all', managers+ only), plus the color that
 * highlights their own jobs in the 'all' view. Re-syncs their calendar in the
 * background so the change takes effect right away.
 */
export async function updateCalendarScopeAction(
  _prev: CalendarScopeState,
  formData: FormData,
): Promise<CalendarScopeState> {
  const { membership } = await getActionContext();

  let scope = String(formData.get("calendar_scope") ?? "mine");
  if (scope !== "all" && scope !== "mine") scope = "mine";
  const canAll = ["owner", "admin", "manager"].includes(membership.role);
  if (scope === "all" && !canAll) {
    return { error: "Only managers can show all organization jobs." };
  }
  let color = String(formData.get("calendar_color") ?? "6");
  if (!VALID_COLOR_IDS.has(color)) color = "6";

  const admin = createSupabaseAdminClient();
  const { error } = (await admin
    .from("memberships")
    .update({ calendar_scope: scope, calendar_color: color } as never)
    .eq("id", membership.id)) as unknown as { error: { message: string } | null };
  if (error) return { error: error.message };

  // Apply to their calendar in the background so the save returns immediately.
  after(async () => {
    try {
      const { reconcileMemberCalendarEvents } = await import("@/lib/google-calendar");
      await reconcileMemberCalendarEvents(membership.id);
    } catch (err) {
      console.error("[gcal] calendar-scope reconcile failed:", err);
    }
  });

  revalidatePath("/field/profile");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Personal Google Calendar connect / disconnect
// ---------------------------------------------------------------------------

/**
 * Redirect the current member to Google's OAuth consent screen so they can
 * connect their personal Google Calendar.
 *
 * Any active member (not just admin) may connect their own calendar.
 * State is prefixed with "mbr:" so the callback knows to use the
 * member-level flow rather than the org-level flow.
 *
 * An ITP-safe cookie is set before the redirect so Safari doesn't lose
 * context when the cross-site redirect comes back from accounts.google.com.
 */
export async function connectMyGoogleCalendarAction(): Promise<never> {
  const membership = await requireMembership();

  const cookieStore = await cookies();
  cookieStore.set("gcal_member_oauth_state", membership.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/api/integrations/google-calendar/callback",
    secure: process.env.NODE_ENV === "production",
  });

  // Prefix state with "mbr:" so the callback routes to the member handler.
  const url = buildGoogleOAuthUrl(`mbr:${membership.id}`);
  redirect(url);
}

/**
 * Re-sync the current member's personal Google Calendar.
 * Useful when the initial bulk sync silently failed, or when bookings
 * were assigned/changed before the connection existed and the member
 * wants to backfill them now without disconnecting + reconnecting.
 */
export async function resyncMyGoogleCalendarAction(): Promise<void> {
  const membership = await requireMembership();
  try {
    await bulkSyncMemberBookings(membership.id);
  } catch (err) {
    console.error("[gcal/member] resync action failed:", err);
  }
  revalidatePath("/field/profile");
}

/**
 * Disconnect the current member's personal Google Calendar.
 * Cleans up upcoming events from their calendar before marking the
 * connection inactive.
 */
export async function disconnectMyGoogleCalendarAction(): Promise<void> {
  const membership = await requireMembership();
  const admin = createSupabaseAdminClient();

  // Delete upcoming events from the member's calendar and clear mapping rows.
  await cleanupMemberCalendarEvents(membership.id).catch(() => {});

  // Mark the connection disconnected (kept for audit).
  await admin
    .from("integration_connections" as never)
    .update({ status: "disconnected", last_error: null } as never)
    .eq("membership_id" as never, membership.id)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active");

  revalidatePath("/field/profile");
}
