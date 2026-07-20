import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStripeEnabled } from "@/lib/stripe";

export type SubscriptionGate =
  | "active"       // paid or trialing — full access
  | "overridden"   // billing_override (free_forever / comp) — full access
  | "expired"      // trial ended / unpaid grace elapsed — WALLED (read blocked)
  | "none";        // no subscription at all, never started — legacy grandfathered

export type SubscriptionInfo = {
  gate: SubscriptionGate;
  /** Days left in trial. Null if not trialing. */
  trialDaysLeft: number | null;
  /** ISO timestamp when trial ends. Null if not trialing. */
  trialEndsAt: string | null;
  /**
   * Days left in the past-due grace window before the org is walled.
   * Non-null ONLY while status is "past_due" and the grace clock is running.
   */
  graceDaysLeft: number | null;
  /** Current subscription status string from Stripe. */
  status: string | null;
};

const TRIAL_DAYS = 14;
const PAST_DUE_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Full subscription info for an org. Cached per-request.
 */
export const getSubscriptionInfo = cache(
  async (organizationId: string): Promise<SubscriptionInfo> => {
    const admin = createSupabaseAdminClient();

    // 1. Check billing override first (free_forever / comp)
    const { data: org } = await admin
      .from("organizations")
      .select("billing_override, trial_started_at")
      .eq("id", organizationId)
      .maybeSingle();

    const orgRow = org as {
      billing_override: string | null;
      trial_started_at: string | null;
    } | null;

    if (orgRow?.billing_override) {
      return {
        gate: "overridden",
        trialDaysLeft: null,
        trialEndsAt: null,
        graceDaysLeft: null,
        status: null,
      };
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
      // No Stripe subscription yet. If trial_started_at is set, enforce the
      // 14-day free trial clock. If not set, this is a legacy org that was
      // created before the trial system existed — grant permanent access so
      // existing customers are never unexpectedly locked out.
      if (orgRow?.trial_started_at) {
        const trialEnd = new Date(
          new Date(orgRow.trial_started_at).getTime() + TRIAL_DAYS * DAY_MS,
        );
        const msLeft = trialEnd.getTime() - Date.now();
        if (msLeft > 0) {
          const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
          return {
            gate: "active",
            trialDaysLeft: daysLeft,
            trialEndsAt: trialEnd.toISOString(),
            graceDaysLeft: null,
            status: "trialing",
          };
        }
        // Trial window has elapsed — wall the org
        return {
          gate: "expired",
          trialDaysLeft: 0,
          trialEndsAt: trialEnd.toISOString(),
          graceDaysLeft: null,
          status: null,
        };
      }
      // Legacy org — no trial clock, grandfathered full access
      return {
        gate: "none",
        trialDaysLeft: null,
        trialEndsAt: null,
        graceDaysLeft: null,
        status: null,
      };
    }

    const status = sub.status as string;
    const trialEndsAt = sub.trial_ends_at ?? null;

    // Compute days left in trial
    let trialDaysLeft: number | null = null;
    if (status === "trialing" && trialEndsAt) {
      const msLeft = new Date(trialEndsAt).getTime() - Date.now();
      trialDaysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS));
    }

    // Active or trialing = full access
    if (status === "active" || status === "trialing") {
      return {
        gate: "active",
        trialDaysLeft,
        trialEndsAt,
        graceDaysLeft: null,
        status,
      };
    }

    // Past due — the renewal charge failed. Give a fixed 7-day grace window to
    // update the card before the org is walled. We anchor the countdown off
    // current_period_end: Stripe leaves it at the failed-renewal moment (the
    // start of the unpaid stretch) and doesn't advance it until a payment
    // succeeds, so it's a stable "grace began here" marker without a new column.
    if (status === "past_due") {
      const anchor = sub.current_period_end
        ? new Date(sub.current_period_end).getTime()
        : null;
      if (anchor !== null) {
        const msLeft = anchor + PAST_DUE_GRACE_DAYS * DAY_MS - Date.now();
        if (msLeft > 0) {
          return {
            gate: "active",
            trialDaysLeft: null,
            trialEndsAt,
            graceDaysLeft: Math.max(0, Math.ceil(msLeft / DAY_MS)),
            status,
          };
        }
        // Grace elapsed — wall until billing is fixed.
        return {
          gate: "expired",
          trialDaysLeft: 0,
          trialEndsAt,
          graceDaysLeft: 0,
          status,
        };
      }
      // No period anchor to measure from — stay lenient rather than risk an
      // accidental lockout. If the card is never fixed, Stripe moves the
      // status to unpaid/canceled, and that path IS walled below.
      return {
        gate: "active",
        trialDaysLeft: null,
        trialEndsAt,
        graceDaysLeft: null,
        status,
      };
    }

    // Anything else (canceled, unpaid, incomplete_expired, paused) — walled
    return {
      gate: "expired",
      trialDaysLeft: 0,
      trialEndsAt,
      graceDaysLeft: null,
      status,
    };
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
  // Enforcement is only live once billing is switched on. Before that there's
  // no way to subscribe past a gate, so never block — this keeps the hard wall
  // (also Stripe-gated) and the per-action guards consistent pre-launch.
  if (!isStripeEnabled()) return true;
  const gate = await getSubscriptionGate(organizationId);
  return gate === "active" || gate === "overridden" || gate === "none";
}
