-- =============================================================================
-- Trial clock: trial_started_at on organizations
-- =============================================================================
-- Implements the 14-day hard free trial introduced in Phase 18.
--
-- Orgs without this column (all existing orgs at time of migration) get
-- gate="none" in getSubscriptionInfo() — they are grandfathered into
-- permanent full access and never see a trial banner. Only orgs created
-- AFTER this migration (whose signup action stamps trial_started_at) are
-- subject to the 14-day clock.
--
-- The column is intentionally not backfilled so existing paying customers
-- and legacy free orgs are unaffected.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

COMMENT ON COLUMN public.organizations.trial_started_at IS
  'Timestamp when the org''s 14-day free trial began. Stamped at signup
   by the signup server action. NULL on all orgs created before this
   migration — those orgs are grandfathered into permanent full access
   (gate="none"). Once the 14-day window elapses without a paid
   subscription, getSubscriptionInfo() returns gate="expired" and the
   app shows the billing lock screen.';

-- Index makes the trial-expiring cron fast: "orgs whose trial has elapsed
-- and have no active subscription" is a common query pattern.
CREATE INDEX IF NOT EXISTS organizations_trial_started_at_idx
  ON public.organizations (trial_started_at)
  WHERE trial_started_at IS NOT NULL;
