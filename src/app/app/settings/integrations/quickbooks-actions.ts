"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildQuickBooksOAuthUrl, issueQBOAuthState } from "@/lib/quickbooks";

/** Redirect an owner/admin to QuickBooks' OAuth consent screen. */
export async function connectQuickBooksAction() {
  const membership = await requireMembership(["owner", "admin"]);

  // An unstorable state guarantees the callback fails — surface it here rather
  // than after a round trip to Intuit.
  let url: string | null = null;
  try {
    const state = await issueQBOAuthState({
      organizationId: membership.organization_id,
      membershipId: membership.id,
    });
    url = buildQuickBooksOAuthUrl(state);
  } catch (err) {
    console.error("[qbo] connect: could not issue OAuth state:", err);
  }

  // redirect() throws NEXT_REDIRECT — must be called outside the try/catch.
  redirect(
    url ??
      `/app/settings/integrations?qb_error=${encodeURIComponent("Couldn't start the QuickBooks connection — please try again")}`,
  );
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
