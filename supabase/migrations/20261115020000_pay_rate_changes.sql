-- =============================================================================
-- A pay rate change has a start date, and a history
-- =============================================================================
-- Every shift freezes the pay rate at clock-in, so changing someone's rate
-- only ever reached shifts worked afterwards. 2026-11-15, Svit: Vira
-- Karpynska's raise back to $18 was entered two weeks into the pay period;
-- her ten shifts already worked stayed at $17 and no screen could move them.
-- The only record of what the rate used to be was the audit log.
--
-- Now a rate change says when it starts. Shifts from that date that are not
-- yet on a pay run are re-priced (src/lib/pay-rate-change.ts), and each
-- change is a row here: who, when, from what to what, effective when, and
-- how many shifts it reached or could not reach.
--
-- Pay rates are hidden from the team (migration 20260601040000), so this
-- table has no policies: the service role only, read for owners and admins
-- by the employee page.
--
-- Run BEFORE the push: the new code writes a row here on every rate change.
-- Safe to run more than once.
-- =============================================================================

create table if not exists public.pay_rate_changes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  -- Null means "no rate set".
  old_rate_cents  integer check (old_rate_cents is null or old_rate_cents >= 0),
  new_rate_cents  integer check (new_rate_cents is null or new_rate_cents >= 0),
  -- The first moment the new rate applies.
  effective_from  timestamptz not null,
  -- Unpaid shifts from that moment moved to the new rate.
  shifts_repriced integer not null default 0 check (shifts_repriced >= 0),
  -- Shifts from that moment already on a pay run, left as they were...
  shifts_on_runs  integer not null default 0 check (shifts_on_runs >= 0),
  -- ...and what the new rate would have added to them. Negative for a cut.
  owed_cents      integer not null default 0,
  -- Who changed it. Kept if that person is later deleted.
  changed_by      uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);

comment on table public.pay_rate_changes is
  'One row per change to a member''s pay rate, with the date it applies from. Service role only.';

create index if not exists pay_rate_changes_member_idx
  on public.pay_rate_changes (membership_id, created_at desc);

alter table public.pay_rate_changes enable row level security;
alter table public.pay_rate_changes force row level security;

revoke all on table public.pay_rate_changes from anon, authenticated;
grant all on table public.pay_rate_changes to service_role;
