-- Pay adjustments: correcting pay after a pay period has been paid.
--
-- WHY
-- A pay period marked paid is locked for good: its hours can't be edited, a
-- missed shift can't be added to it, and it can't be deleted or un-paid
-- (that would pay everyone on it twice). So a mistake found afterwards had no
-- way to be put right. The nearest thing was a manual bonus, which can only
-- add money and calls a correction a bonus.
--
-- NOW
-- An adjustment is an amount for one person, plus or minus, with a note
-- saying what it corrects. It waits until the next pay period is prepared,
-- which picks it up as its own line (payroll_items.adjustment_cents) and
-- stamps it with that run. Deleting an unpaid run releases it again
-- (ON DELETE SET NULL), the same way hours and bonuses are released.
--
-- The paid period itself is never touched.
--
-- Run BEFORE the code push: preparing a pay period writes adjustment_cents.
-- Idempotent.

begin;

create table if not exists public.pay_adjustments (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- NO ACTION, like time_entries and bonuses: a person with pay history is
  -- deactivated, never deleted out from under it.
  employee_id           uuid not null references public.memberships(id) on delete no action,
  -- Positive pays more, negative takes back. Never zero.
  amount_cents          integer not null check (amount_cents <> 0 and abs(amount_cents) <= 10000000),
  reason                text not null check (length(btrim(reason)) between 1 and 500),
  -- The period being corrected, for the record. Optional.
  corrects_period_start date,
  corrects_period_end   date,
  -- NULL until a pay period picks it up.
  payroll_run_id        uuid references public.payroll_runs(id) on delete set null,
  created_by            uuid references public.memberships(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists pay_adjustments_org_waiting_idx
  on public.pay_adjustments (organization_id) where payroll_run_id is null;
create index if not exists pay_adjustments_run_idx
  on public.pay_adjustments (payroll_run_id);
create index if not exists pay_adjustments_employee_idx
  on public.pay_adjustments (employee_id);

alter table public.pay_adjustments enable row level security;

drop policy if exists "admins manage own org pay_adjustments" on public.pay_adjustments;
create policy "admins manage own org pay_adjustments"
  on public.pay_adjustments for all
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
        and role in ('owner', 'admin')
    )
  )
  with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
        and role in ('owner', 'admin')
    )
  );

-- A person reads the adjustments to their own pay.
drop policy if exists "employees read own pay_adjustments" on public.pay_adjustments;
create policy "employees read own pay_adjustments"
  on public.pay_adjustments for select
  using (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

-- The adjustments a person's line in a pay run came to. Signed: a run that
-- takes $30 back holds -3000. total_cents still may not go below zero.
alter table public.payroll_items
  add column if not exists adjustment_cents integer not null default 0;

commit;
