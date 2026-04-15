"use server";

import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RedeemResult =
  | { ok: true; kind: "free_forever" | "comp" }
  | {
      ok: false;
      reason:
        | "invalid"
        | "expired"
        | "exhausted"
        | "already_redeemed"
        | "already_overridden"
        | "empty";
    };

export async function redeemPromoCodeAction(
  formData: FormData,
): Promise<RedeemResult> {
  const membership = await requireMembership(["owner", "admin"]);

  const rawCode = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!rawCode) return { ok: false, reason: "empty" };

  const admin = createSupabaseAdminClient();

  // If this org already has an override, don't let them stack codes.
  const { data: org } = await admin
    .from("organizations")
    .select("billing_override")
    .eq("id", membership.organization_id)
    .maybeSingle();

  if ((org as { billing_override: string | null } | null)?.billing_override) {
    return { ok: false, reason: "already_overridden" };
  }

  // Look up the code.
  const { data: promo } = await admin
    .from("promo_codes" as never)
    .select(
      "id, kind, active, expires_at, max_redemptions, redemption_count",
    )
    .eq("code", rawCode)
    .maybeSingle();

  const code = promo as {
    id: string;
    kind: "free_forever" | "comp";
    active: boolean;
    expires_at: string | null;
    max_redemptions: number;
    redemption_count: number;
  } | null;

  if (!code || !code.active) return { ok: false, reason: "invalid" };
  if (code.expires_at && new Date(code.expires_at) < new Date()) {
    return { ok: false, reason: "expired" };
  }
  if (code.redemption_count >= code.max_redemptions) {
    return { ok: false, reason: "exhausted" };
  }

  // Has this org already redeemed this specific code? (defensive — we also
  // guard against any override above)
  const { data: existing } = await admin
    .from("promo_redemptions" as never)
    .select("id")
    .eq("promo_code_id", code.id)
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  if (existing) return { ok: false, reason: "already_redeemed" };

  // Atomically increment redemption_count, guarded by (count < max AND active).
  const { data: incremented, error: incErr } = await admin
    .from("promo_codes" as never)
    .update({
      redemption_count: code.redemption_count + 1,
    } as never)
    .eq("id", code.id)
    .eq("active", true)
    .lt("redemption_count", code.max_redemptions)
    .select("id")
    .maybeSingle();

  if (incErr || !incremented) {
    // Race: someone else claimed the last slot between our read and write.
    return { ok: false, reason: "exhausted" };
  }

  // Record the redemption.
  await admin.from("promo_redemptions" as never).insert({
    promo_code_id: code.id,
    organization_id: membership.organization_id,
    redeemed_by: membership.id,
  } as never);

  // Flip the org into override.
  await admin
    .from("organizations")
    .update({
      billing_override: code.kind,
      billing_override_note: `Redeemed code at ${new Date().toISOString()}`,
      billing_override_at: new Date().toISOString(),
    } as never)
    .eq("id", membership.organization_id);

  revalidatePath("/app/settings/billing");

  return { ok: true, kind: code.kind };
}
