import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SubscriptionGate =
  | "active"       // paid or trialing — full access
  | "overridden"   // billing_override (free_forever / comp) — full access
  | "expired"      // trial ended, no active sub — read-only
  | "none";        // no subscription at all, never started — show subscribe CTA

/**
 * Check whether an org has an active subscription, active trial,
 * or a billing override. Cached per-request.
 */
export const getSubscriptionGate = cache(
  async (organizationId: string): Promise<SubscriptionGate> => {
    const admin = createSupabaseAdminClient();

    // 1. Check billing override first (free_forever / comp)
    const { data: org } = await admin
      .from("organizations")
      .select("billing_override")
      .eq("id", organizationId)
      .maybeSingle();

    const override = (org as { billing_override: string | null } | null)
      ?.billing_override;
    if (override) return "overridden";

    // 2. Check subscription status
    const { data: sub } = await admin
      .from("subscriptions")
      .select(
        "status, trial_ends_at, current_period_end, cancel_at_period_end",
      )
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!sub || !sub.status) return "none";

    const status = sub.status as string;

    // Active or trialing = full access
    if (status === "active" || status === "trialing") return "active";

    // Past due — give them a grace window (Stripe retries for ~3 weeks)
    if (status === "past_due") return "active";

    // Anything else (canceled, unpaid, incomplete_expired, paused)
    return "expired";
  },
);

/**
 * Whether the org can create new data (bookings, invoices, etc).
 * Expired orgs get read-only access.
 */
export async function canCreateData(
  organizationId: string,
): Promise<boolean> {
  const gate = await getSubscriptionGate(organizationId);
  return gate === "active" || gate === "overridden" || gate === "none";
  // "none" allowed because new signups haven't subscribed yet —
  // they're in the "try before you buy" window. Once they start a trial
  // and it expires, THEN they're gated.
}
