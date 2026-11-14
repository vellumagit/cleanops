-- supabase/migrations/20261116010000_plan_tier_team.sql
--
-- A fourth plan: Team ($119, up to 10 cleaners), between Starter and Growth.
--
-- subscriptions.plan_tier carried an inline CHECK listing the three original
-- tiers, so the Stripe webhook's upsert of plan_tier = 'team' would fail and
-- a Team customer would never get a subscription row. Widen it.
--
-- Additive: every existing value stays valid. Run BEFORE pushing the code
-- that knows about Team.

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_tier_check;

alter table public.subscriptions
  add constraint subscriptions_plan_tier_check
    check (plan_tier in ('starter', 'team', 'growth', 'enterprise'));
