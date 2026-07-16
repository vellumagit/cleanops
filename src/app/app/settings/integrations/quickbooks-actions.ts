"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildQuickBooksOAuthUrl, issueQBOAuthState } from "@/lib/quickbooks";

/** Redirect an owner/admin to QuickBooks' OAuth consent screen. */
export async function connectQuickBooksAction() {
  const membership = await requireMembership(["owner", "admin"]);
  const state = await issueQBOAuthState({
    organizationId: membership.organization_id,
    membershipId: membership.id,
  });
  redirect(buildQuickBooksOAuthUrl(state));
}

/** Disconnect QuickBooks for the current org. */
export async function disconnectQuickBooksAction() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  await admin
    .from("integration_connections" as never)
    .update({ status: "disconnected", last_error: null } as never)
    .eq("organization_id" as never, membership.organization_id)
    .eq("provider" as never, "quickbooks")
    .eq("status" as never, "active");
  revalidatePath("/app/settings/integrations");
}
