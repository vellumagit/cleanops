import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanFromPriceId, isStripeEnabled, type PlanTier } from "@/lib/stripe";

/**
 * How many cleaners each plan includes. A cleaner is an ACTIVE membership
 * with role `employee`, employees and subcontractors alike. Owners, admins
 * and managers are the office and never count. Null means no limit.
 *
 * Decided with Brian on 2026-11-14: Starter 3, Team 10, Growth 25,
 * Enterprise unlimited (sold by hand for 25+).
 */
export const CLEANER_LIMIT_BY_PLAN: Record<PlanTier, number | null> = {
  starter: 3,
  team: 10,
  growth: 25,
  enterprise: null,
};

/**
 * A company still on its free trial hasn't picked a plan, so it gets the
 * biggest self-serve one: it can try the product with its whole crew and
 * choose at the end.
 */
export const TRIAL_CLEANER_LIMIT = 25; // Growth's limit

const PLAN_NAMES: Record<PlanTier, string> = {
  starter: "Starter",
  team: "Team",
  growth: "Growth",
  enterprise: "Enterprise",
};

/**
 * Why a company has the limit it has. Every exempt reason fails OPEN: the
 * limit exists to sell the right plan, never to stop a company working.
 */
export type CleanerLimit =
  | { limit: number; plan: PlanTier | null; source: "plan" | "trial" }
  | {
      limit: null;
      plan: PlanTier | null;
      source:
        | "billing_off" // STRIPE_ENABLED isn't on: there's nothing to upgrade to
        | "comped" // billing_override, e.g. a redeemed promo code
        | "legacy" // made before trials existed, grandfathered like subscription.ts
        | "unlimited_plan" // Enterprise
        | "unknown_plan"; // a price this build doesn't recognise
    };

type OrgRow = { billing_override: string | null; trial_started_at: string | null };
type SubRow = { status: string | null; plan_tier: string | null; stripe_price_id: string | null };

function asPlan(value: string | null): PlanTier | null {
  return value && Object.hasOwn(CLEANER_LIMIT_BY_PLAN, value) ? (value as PlanTier) : null;
}

/**
 * The cleaner limit for a company. Mirrors the gates in subscription.ts so a
 * company sees one consistent story: comped is exempt, a company with no
 * Stripe subscription is either on its trial or a grandfathered legacy org,
 * and nothing is enforced until billing is switched on.
 */
export async function resolveCleanerLimit(
  admin: SupabaseClient,
  organizationId: string,
): Promise<CleanerLimit> {
  if (!isStripeEnabled()) return { limit: null, plan: null, source: "billing_off" };

  const { data: org } = (await admin
    .from("organizations")
    .select("billing_override, trial_started_at")
    .eq("id", organizationId)
    .maybeSingle()) as unknown as { data: OrgRow | null };

  if (org?.billing_override) return { limit: null, plan: null, source: "comped" };

  const { data: sub } = (await admin
    .from("subscriptions")
    .select("status, plan_tier, stripe_price_id")
    .eq("organization_id", organizationId)
    .maybeSingle()) as unknown as { data: SubRow | null };

  // A subscriptions row with no status is a Stripe customer who never
  // finished checkout: subscription.ts treats it as no subscription, so do we.
  if (!sub?.status) {
    if (org?.trial_started_at) return { limit: TRIAL_CLEANER_LIMIT, plan: null, source: "trial" };
    return { limit: null, plan: null, source: "legacy" };
  }

  const plan = asPlan(sub.plan_tier) ?? getPlanFromPriceId(sub.stripe_price_id);
  if (!plan) return { limit: null, plan: null, source: "unknown_plan" };
  const limit = CLEANER_LIMIT_BY_PLAN[plan];
  if (limit === null) return { limit: null, plan, source: "unlimited_plan" };
  return { limit, plan, source: "plan" };
}

/** Active cleaners, optionally plus invitations to join as one that are still open. */
export async function countCleaners(
  admin: SupabaseClient,
  organizationId: string,
  opts: { includePendingInvites?: boolean } = {},
): Promise<number> {
  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "employee")
    .eq("status", "active");
  if (error) throw new Error(`Could not count cleaners: ${error.message}`);
  let total = count ?? 0;

  if (opts.includePendingInvites) {
    const { count: pending, error: inviteError } = await admin
      .from("invitations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "employee")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());
    if (inviteError) throw new Error(`Could not count invitations: ${inviteError.message}`);
    total += pending ?? 0;
  }
  return total;
}

export type CleanerSeatCheck =
  | { ok: true }
  | { ok: false; limit: number; used: number; plan: PlanTier | null; source: "plan" | "trial" };

/**
 * Whether the company can take on one more cleaner. Call it only when the
 * write would ADD an active employee: someone already counted (an active
 * shadow record being linked to a login, an active member being edited)
 * isn't a new seat.
 *
 * Nobody already working is ever touched. A company over its limit (it
 * downgraded, or had more cleaners before limits existed) keeps everyone;
 * it just can't add more until it's back under or upgrades.
 */
export async function checkCleanerSeat(
  admin: SupabaseClient,
  organizationId: string,
  opts: { includePendingInvites?: boolean } = {},
): Promise<CleanerSeatCheck> {
  const resolved = await resolveCleanerLimit(admin, organizationId);
  if (resolved.limit === null) return { ok: true };
  const used = await countCleaners(admin, organizationId, opts);
  if (used < resolved.limit) return { ok: true };
  return { ok: false, limit: resolved.limit, used, plan: resolved.plan, source: resolved.source };
}

function planPhrase(check: Extract<CleanerSeatCheck, { ok: false }>): string {
  if (check.source === "trial") return `Your free trial includes up to ${check.limit} cleaners`;
  if (check.plan) return `The ${PLAN_NAMES[check.plan]} plan includes up to ${check.limit} cleaners`;
  return `Your plan includes up to ${check.limit} cleaners`;
}

/** For the owner or admin adding someone: what's wrong and how to fix it. */
export function cleanerLimitMessage(
  check: Extract<CleanerSeatCheck, { ok: false }>,
  opts: { countsInvites?: boolean } = {},
): string {
  const have = opts.countsInvites
    ? `you have ${check.used} active or invited`
    : `you have ${check.used} active`;
  return (
    `${planPhrase(check)}, and ${have}. ` +
    "To add another, upgrade in Settings → Billing, or deactivate a cleaner or cancel an invite first."
  );
}

/** For the person accepting an invite: it isn't their fault, so point them at the company. */
export const CLEANER_LIMIT_CLAIM_MESSAGE =
  "This company has reached the number of cleaners its plan includes, so the invite can't be accepted yet. " +
  "Ask the person who invited you to upgrade the plan or free up a spot, then open this link again.";
