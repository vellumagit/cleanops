-- Shift acceptance: each assigned cleaner must accept (or decline) their
-- assignment. New booking_assignees rows default to 'pending'; the cleaner
-- accepts in the field app. Declining removes them from the job (handled in
-- app code) and flags the shift unfilled.

alter table public.booking_assignees
  add column if not exists acceptance_status text not null default 'pending',
  add column if not exists responded_at timestamptz;

alter table public.booking_assignees
  drop constraint if exists booking_assignees_acceptance_status_check;
alter table public.booking_assignees
  add constraint booking_assignees_acceptance_status_check
  check (acceptance_status in ('pending', 'accepted', 'declined'));

-- Grandfather every EXISTING assignment as already accepted, so turning the
-- feature on doesn't force current crews to re-confirm hundreds of live jobs.
-- Only assignments created from here on start as 'pending'.
update public.booking_assignees
set acceptance_status = 'accepted',
    responded_at = coalesce(responded_at, now())
where acceptance_status = 'pending';

create index if not exists booking_assignees_acceptance_idx
  on public.booking_assignees (membership_id, acceptance_status);
