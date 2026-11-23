-- A visitor picks a time on a company's booking page (roadmap phase 3).
--
-- WHY
-- docs/online-booking-roadmap.md, phase 3. Phase 2 worked out which times
-- are open and showed them to the office only. This lets a company offer
-- them to the public, if and when it chooses to.
--
-- NOW
-- booking_pages.time_booking
--   'off'      the page takes requests only, as it does today. The default,
--              so no page changes when this ships.
--   'approve'  a visitor picks a time; the visit is saved as pending and
--              holds the time until the office confirms or declines it.
--   'instant'  a visitor picks a time and the visit is confirmed.
--
-- bookings.booked_online_at
--   When a visit was booked from the public page. Null for every visit the
--   office made. It is how the office sees "Booked online".
--
-- Run BEFORE the code push: the public page reads time_booking.
-- Idempotent. Changes no existing row's behaviour.

begin;

alter table public.booking_pages
  add column if not exists time_booking text not null default 'off'
    check (time_booking in ('off', 'approve', 'instant'));

alter table public.bookings
  add column if not exists booked_online_at timestamptz;

comment on column public.bookings.booked_online_at is
  'Set when a visitor booked this visit from the company''s public booking page. Null = made by the office.';

commit;

notify pgrst, 'reload schema';
