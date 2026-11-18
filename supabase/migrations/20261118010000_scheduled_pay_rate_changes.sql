-- =============================================================================
-- A pay rate change planned for a future date
-- supabase/migrations/20261118010000_scheduled_pay_rate_changes.sql
-- =============================================================================
-- Safe to run more than once, and safe to run before or after the code that
-- uses it. Until it runs, saving a raise for a future date is refused with a
-- message; nothing else is affected.
--
-- A raise could only start now or on a past date: "the start date can't be
-- in the future. To plan a raise, change the rate on the day it starts."
-- The office had to remember to come back on the day.
--
-- A change saved for a future date is now a row in pay_rate_changes marked
-- scheduled, with applied_at empty. On its day it is applied: the person's
-- rate changes, applied_at is stamped, and any unpaid shift from that day on
-- takes the new rate. It is applied the first time the person clocks in on
-- or after the day, and by the nightly cleanup job for everyone else.
--
-- `scheduled` defaults to false, so every change already on record stays
-- exactly what it was: history, never something waiting to be applied.

alter table public.pay_rate_changes
  add column if not exists scheduled boolean not null default false,
  add column if not exists applied_at timestamptz;

comment on column public.pay_rate_changes.scheduled is
  'True for a change saved ahead of its start date. With applied_at null it is still waiting.';
comment on column public.pay_rate_changes.applied_at is
  'When a scheduled change took effect. Null while it waits, and on changes that were never scheduled.';

-- The ones still waiting, found by person and by due date.
create index if not exists pay_rate_changes_waiting_idx
  on public.pay_rate_changes (effective_from)
  where scheduled and applied_at is null;

notify pgrst, 'reload schema';
