-- Open times: the rules a company sets for online booking.
--
-- WHY
-- Roadmap phase 2 (docs/online-booking-roadmap.md). Before a visitor can
-- pick a time, the app has to be able to work out which times are open.
-- That takes a few things only the company can say.
--
-- NOW
-- On the company's booking page (booking_pages):
--   opening_hours       hours by weekday, 0 = Sunday:
--                       { "1": [{ "start": "09:00", "end": "17:00" }], ... }
--                       A missing day is closed. Empty means closed all
--                       week, which is every page today: nothing is open
--                       until the company says when.
--   min_notice_hours    how far ahead a booking must be made
--   max_days_ahead      how many days out bookings are taken
--   gap_minutes         time kept clear on each side of a cleaner's jobs
--   slot_step_minutes   how far apart offered start times are
--
-- On a person (memberships):
--   takes_online_bookings   off for everyone today. Only cleaners the
--                           company ticks are ever offered.
--
-- On a service (service_types):
--   online_crew_size    how many cleaners the job needs when booked online
--
-- Nothing public changes with this migration: these feed an office-only
-- preview until phase 3.
--
-- Run BEFORE the code push: Settings, Online booking reads these.
-- Idempotent. Changes no existing rows' behaviour.

begin;

alter table public.booking_pages
  add column if not exists opening_hours jsonb not null default '{}'::jsonb;
alter table public.booking_pages
  add column if not exists min_notice_hours integer not null default 24
    check (min_notice_hours between 0 and 720);
alter table public.booking_pages
  add column if not exists max_days_ahead integer not null default 60
    check (max_days_ahead between 0 and 365);
alter table public.booking_pages
  add column if not exists gap_minutes integer not null default 30
    check (gap_minutes between 0 and 240);
alter table public.booking_pages
  add column if not exists slot_step_minutes integer not null default 30
    check (slot_step_minutes in (15, 30, 60));

alter table public.memberships
  add column if not exists takes_online_bookings boolean not null default false;

alter table public.service_types
  add column if not exists online_crew_size integer not null default 1
    check (online_crew_size between 1 and 6);

commit;

notify pgrst, 'reload schema';
