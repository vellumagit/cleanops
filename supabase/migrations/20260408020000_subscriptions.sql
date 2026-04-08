-- =============================================================================
-- CleanOps Phase 10 — Stripe subscriptions (scaffold)
-- =============================================================================
-- Adds a `subscriptions` table that mirrors a Stripe subscription so the app
-- can read plan / status without having to call the Stripe API on every
-- request. The table is intentionally permissive (everything nullable) so
-- the webhook route can write whatever Stripe sends.
--
-- THIS SCHEMA IS LIVE BUT THE CODE PATHS THAT USE IT ARE DISABLED until you
-- flip STRIPE_ENABLED=true in the environment. We ship the table so the
-- webhook route can be deployed without a follow-up migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: subscriptions
-- -----------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null unique references public.organizations(id) on delete cascade,
  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,
  stripe_price_id          text,
  status                   text,            -- trialing | active | past_due | canceled | unpaid | incomplete
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  trial_ends_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists subscriptions_organization_id_idx
  on public.subscriptions (organization_id);
create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

-- -----------------------------------------------------------------------------
-- Touch updated_at
-- -----------------------------------------------------------------------------

create or replace function public.subscriptions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row
  execute function public.subscriptions_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Subscriptions are tenant-scoped. Members of an org can READ their org's
-- subscription row (so the billing portal can render the plan). Only the
-- webhook route writes to this table, and it does so with the service-role
-- key which bypasses RLS by design.

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

drop policy if exists "members read own org subscription" on public.subscriptions;
create policy "members read own org subscription"
on public.subscriptions for select
to authenticated
using (
  organization_id in (
    select organization_id
    from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- No INSERT / UPDATE / DELETE policies — the webhook route is the only
-- writer and it uses the service-role key.

comment on table public.subscriptions is
  'Mirror of the org''s Stripe subscription. Written exclusively by the Stripe webhook route.';
