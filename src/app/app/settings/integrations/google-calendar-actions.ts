"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildGoogleOAuthUrl,
  cleanupOrgCalendarEvents,
} from "@/lib/google-calendar";

/**
 * Redirect the admin to Google's OAuth consent screen.
 * The membership ID is passed as `state` so the callback can verify
 * who initiated the flow.
 *
 * We also set a short-lived same-site cookie (`gcal_oauth_state`) with the
 * membership ID. This lets the callback verify the flow without needing the
 * Supabase session cookie — important on Safari/Mac where ITP can strip
 * session cookies that were set before a cross-site redirect (e.g. to
 * accounts.google.com).
 */
export async function connectGoogleCalendarAction() {
  const membership = await requireMembership(["owner", "admin"]);

  // Persist the membership ID in a short-lived same-site cookie so the
  // callback can verify state even if the Supabase session is unavailable.
  const cookieStore = await cookies();
  cookieStore.set("gcal_oauth_state", membership.id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — more than enough for any OAuth flow
    path: "/api/integrations/google-calendar/callback",
    secure: process.env.NODE_ENV === "production",
  });

  const url = buildGoogleOAuthUrl(membership.id);
  redirect(url);
}

/**
 * Disconnect Google Calendar for the current org.
 * Marks the connection as "disconnected" (we keep the row for audit).
 */
export async function disconnectGoogleCalendarAction() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  // Delete upcoming events from the old calendar and reset event IDs on
  // bookings before marking the connection inactive. This ensures the old
  // calendar is left clean and no stale IDs cause silent failures later.
  // Errors are swallowed inside cleanupOrgCalendarEvents — the disconnect
  // always completes even if GCal is temporarily unreachable.
  await cleanupOrgCalendarEvents(membership.organization_id).catch(() => {});

  await admin
    .from("integration_connections" as never)
    .update({ status: "disconnected", last_error: null } as never)
    .eq("organization_id" as never, membership.organization_id)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active");

  revalidatePath("/app/settings/integrations");
}
