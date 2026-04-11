"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildGoogleOAuthUrl } from "@/lib/google-calendar";

/**
 * Redirect the admin to Google's OAuth consent screen.
 * The membership ID is passed as `state` so the callback can verify
 * who initiated the flow.
 */
export async function connectGoogleCalendarAction() {
  const membership = await requireMembership(["owner", "admin"]);
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

  await admin
    .from("integration_connections" as never)
    .update({ status: "disconnected", last_error: null } as never)
    .eq("organization_id" as never, membership.organization_id)
    .eq("provider" as never, "google_calendar")
    .eq("status" as never, "active");

  revalidatePath("/app/settings/integrations");
}
