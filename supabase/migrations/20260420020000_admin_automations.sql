-- Infrastructure for admin-facing automations.
--
--   bookings.unassigned_alert_sent_at — dedup column so the daily
--     unassigned-booking scanner emails the owner at most once per
--     booking. Set when we alert; cleared if the booking is later
--     assigned (a trigger keeps it in sync).
--
-- Idempotent — safe to re-run.

alter table public.bookings
  add column if not exists unassigned_alert_sent_at timestamptz;

comment on column public.bookings.unassigned_alert_sent_at is
  'Timestamp the unassigned-booking alert was sent for this row. Prevents repeated alerts on the same booking. Cleared automatically by the bookings_clear_unassigned_alert trigger when the booking gets an assignee.';

-- Partial index for the scanner.
create index if not exists bookings_unassigned_alert_pending_idx
  on public.bookings (scheduled_at)
  where assigned_to is null and unassigned_alert_sent_at is null;

-- When a booking is assigned (or reassigned from null), clear the
-- alert timestamp so that if it later becomes unassigned again the
-- scanner will fire a fresh alert.
create or replace function public.bookings_clear_unassigned_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and new.unassigned_alert_sent_at is not null then
    new.unassigned_alert_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_clear_unassigned_alert_trg on public.bookings;
create trigger bookings_clear_unassigned_alert_trg
  before update of assigned_to on public.bookings
  for each row execute function public.bookings_clear_unassigned_alert();
