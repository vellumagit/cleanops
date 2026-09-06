-- ============================================================
-- Unconfirmed shifts get chased, and the office hears about it
-- ============================================================
--
-- 2026-09-05: Anna had two visits for the same client waiting for her
-- confirmation, accepted the far one, and could not clock in on today's.
-- Nothing had reminded her, and nothing told the office a shift starting
-- in two hours was still unanswered. Two stamps on the assignment row so
-- the 30-minute shift watch can send each nudge exactly once.

alter table public.booking_assignees
  add column if not exists confirm_reminded_at timestamptz,
  add column if not exists confirm_escalated_at timestamptz;

comment on column public.booking_assignees.confirm_reminded_at is
  'When the cleaner was reminded to confirm this shift (the day before). NULL = not yet.';
comment on column public.booking_assignees.confirm_escalated_at is
  'When the shift was still unconfirmed close to start and both the cleaner and the office were told. NULL = not yet.';

create index if not exists booking_assignees_pending_idx
  on public.booking_assignees (booking_id)
  where acceptance_status = 'pending';

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notification_type' and e.enumlabel = 'shift_unconfirmed'
  ) then
    alter type public.notification_type add value 'shift_unconfirmed';
  end if;
end $$;

notify pgrst, 'reload schema';
