"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  buildSageOAuthUrl,
  issueSageOAuthState,
  setSageTaxRegionId,
} from "@/lib/sage";

/**
 * Redirect the admin to Sage's OAuth consent screen.
 */
export async function connectSageAction() {
  const membership = await requireMembership(["owner", "admin"]);

  // Single-use random CSRF state (not the membership id) — claimed at callback.
  // If it can't be stored there's no point bouncing the user to Sage: the
  // callback would fail minutes later with a misleading "invalid session".
  let url: string | null = null;
  try {
    const state = await issueSageOAuthState({
      organizationId: membership.organization_id,
      membershipId: membership.id,
    });
    url = buildSageOAuthUrl(state);
  } catch (err) {
    console.error("[sage] connect: could not issue OAuth state:", err);
  }

  // redirect() throws NEXT_REDIRECT — must be called outside the try/catch.
  redirect(
    url ??
      `/app/settings/integrations?sage_error=${encodeURIComponent("Couldn't start the Sage connection — please try again")}`,
  );
}

/**
 * Save the org's Sage tax region (e.g. "CA-ON"). Sage rejects sales invoices
 * that don't name a destination region, so this is required before any invoice
 * can sync. Stored on the connection's metadata — no schema change needed.
 */
export async function saveSageTaxRegionAction(
  regionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const membership = await requireMembership(["owner", "admin"]);

  const region = regionId.trim();
  if (!region) return { ok: false, error: "Pick a tax region first." };
  if (region.length > 32) {
    return { ok: false, error: "That doesn't look like a Sage region id." };
  }

  const saved = await setSageTaxRegionId(membership.organization_id, region);
  if (!saved) {
    return {
      ok: false,
      error: "Sage isn't connected — connect it first, then set the region.",
    };
  }

  revalidatePath("/app/settings/integrations");
  return { ok: true };
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
