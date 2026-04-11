"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildSageOAuthUrl } from "@/lib/sage";

/**
 * Redirect the admin to Sage's OAuth consent screen.
 */
export async function connectSageAction() {
  const membership = await requireMembership(["owner", "admin"]);
  const url = buildSageOAuthUrl(membership.id);
  redirect(url);
}

/**
 * Disconnect Sage for the current org.
 */
export async function disconnectSageAction() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  await admin
    .from("integration_connections" as never)
    .update({ status: "disconnected", last_error: null } as never)
    .eq("organization_id" as never, membership.organization_id)
    .eq("provider" as never, "sage")
    .eq("status" as never, "active");

  revalidatePath("/app/settings/integrations");
}
