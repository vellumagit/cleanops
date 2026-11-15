-- =============================================================================
-- Add-ons: travel, reimbursements and other fixed amounts on a statement
-- =============================================================================
-- 2026-11-15, Svit: "is there a way to add extra pay such as travel time,
-- reimbursement type of add on?" Bonuses exist, but they reach only the
-- employee payroll run, and every Svit cleaner is paid as a subcontractor.
-- A parking receipt had nowhere to go but paper.
--
-- An add-on is a dollar amount for one person on one day, with a kind and a
-- note. Preparing the pay period puts it on that person's contractor
-- statement (src/lib/contractor-run-create.ts), as its own amount on top of
-- their hours, and stamps it with the statement so it can never be paid
-- twice. Deleting a statement releases its add-ons with its hours.
--
-- subcontractor_pay_items.total_cents stays "what this person is paid" and
-- now includes add-ons, so every screen, notice and Sage bill that reads it
-- is right without change. The two new columns say how much of it is add-ons
-- and how much of that is reimbursement (money paid back, not earnings).
--
-- Pay is hidden from the team, so no policies: service role only. The
-- office reads and writes through the app; a cleaner sees her own on her pay
-- page, read by the server for her.
--
-- Run BEFORE the push: preparing a period reads this table. Safe to run
-- more than once.
-- =============================================================================

begin;

create table if not exists public.pay_addons (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  membership_id        uuid not null references public.memberships(id) on delete cascade,
  kind                 text not null check (kind in ('reimbursement', 'travel', 'other')),
  amount_cents         integer not null check (amount_cents > 0 and amount_cents <= 1000000),
  -- The day it belongs to: decides which pay period picks it up.
  work_date            date not null,
  note                 text not null check (length(note) between 1 and 300),
  -- Set when a statement pays it. Released if that statement is deleted.
  subcontractor_run_id uuid references public.subcontractor_pay_runs(id) on delete set null,
  created_by           uuid references public.memberships(id) on delete set null,
  created_at           timestamptz not null default now()
);

comment on table public.pay_addons is
  'Fixed amounts (travel, reimbursements) added to a contractor''s pay for a day. Service role only.';

create index if not exists pay_addons_org_date_idx
  on public.pay_addons (organization_id, work_date);
create index if not exists pay_addons_member_idx
  on public.pay_addons (membership_id, work_date desc);
create index if not exists pay_addons_run_idx
  on public.pay_addons (subcontractor_run_id)
  where subcontractor_run_id is not null;

alter table public.pay_addons enable row level security;
alter table public.pay_addons force row level security;
revoke all on table public.pay_addons from anon, authenticated;
grant all on table public.pay_addons to service_role;

alter table public.subcontractor_pay_items
  add column if not exists addons_cents integer not null default 0 check (addons_cents >= 0),
  add column if not exists reimbursement_cents integer not null default 0 check (reimbursement_cents >= 0);

comment on column public.subcontractor_pay_items.addons_cents is
  'The part of total_cents that is add-ons (pay_addons), not hours.';
comment on column public.subcontractor_pay_items.reimbursement_cents is
  'The part of addons_cents that is reimbursement: money paid back, not earnings.';

commit;

notify pgrst, 'reload schema';
