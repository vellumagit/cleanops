"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
