import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SubscriptionGate =
  | "active"       // paid or trialing — full access
  | "overridden"   // billing_override (free_forever / comp) — full access
  | "expired"      // trial ended, no active sub — read-only
  | "none";        // no subscription at all, never started — show subscribe CTA

export type SubscriptionInfo = {
  gate: SubscriptionGate;
  /** Days left in trial. Null if not trialing. */
  trialDaysLeft: number | null;
  /** ISO timestamp when trial ends. Null if not trialing. */
  trialEndsAt: string | null;
  /** Current subscription status string from Stripe. */
  status: string | null;
};

/**
 * Full subscription info for an org. Cached per-request.
 */
export const getSubscriptionInfo = cache(
  async (organizationId: string): Promise<SubscriptionInfo> => {
    const admin = createSupabaseAdminClient();

    // 1. Check billing override first (free_forever / comp)
    const { data: org } = await admin
      .from("organizations")
      .select("billing_override")
      .eq("id", organizationId)
      .maybeSingle();

    const override = (org as { billing_override: string | null } | null)
      ?.billing_override;
    if (override) {
      return { gate: "overridden", trialDaysLeft: null, trialEndsAt: null, status: null };
    }

    // 2. Check subscription status
    const { data: sub } = await admin
      .from("subscriptions")
      .select(
        "status, trial_ends_at, current_period_end, cancel_at_period_end",
      )
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!sub || !sub.status) {
      return { gate: "none", trialDaysLeft: null, trialEndsAt: null, status: null };
    }

    const status = sub.status as string;
    const trialEndsAt = sub.trial_ends_at ?? null;

    // Compute days left in trial
    let trialDaysLeft: number | null = null;
    if (status === "trialing" && trialEndsAt) {
      const msLeft = new Date(trialEndsAt).getTime() - Date.now();
      trialDaysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    }

    // Active or trialing = full access
    if (status === "active" || status === "trialing") {
      return { gate: "active", trialDaysLeft, trialEndsAt, status };
    }

    // Past due — give them a grace window (Stripe retries for ~3 weeks)
    if (status === "past_due") {
      return { gate: "active", trialDaysLeft: null, trialEndsAt, status };
    }

    // Anything else (canceled, unpaid, incomplete_expired, paused)
    return { gate: "expired", trialDaysLeft: 0, trialEndsAt, status };
  },
);

/**
 * Backward-compatible — returns just the gate.
 */
export const getSubscriptionGate = cache(
  async (organizationId: string): Promise<SubscriptionGate> => {
    const info = await getSubscriptionInfo(organizationId);
    return info.gate;
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
}
