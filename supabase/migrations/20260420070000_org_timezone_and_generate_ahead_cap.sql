-- Per-organization timezone + raise the generate_ahead upper bound.
--
-- 1. organizations.timezone — IANA tz string (e.g. "America/Edmonton").
--    Defaults to "America/Toronto" since our first paying customers are
--    in Canada. The booking form, recurrence generator, and admin-
--    configurable crons all read this to present / interpret wall-clock
--    times correctly.
--
-- 2. booking_series.generate_ahead upper bound was 52, capping at roughly
--    a year of weekly bookings. Since the UI no longer exposes this
--    field (it's an internal batch size used by the extend cron), the
--    ceiling is purely a sanity guard. Bumped to 520 = 10 years of
--    weekly, well beyond any real use case.
--
-- Idempotent — safe to re-run.

alter table public.organizations
  add column if not exists timezone text not null default 'America/Toronto';

comment on column public.organizations.timezone is
  'IANA timezone string (e.g. "America/Edmonton"). Applied when interpreting booking times entered by the admin and when formatting times in client-facing emails. Defaults to America/Toronto.';

alter table public.booking_series
  drop constraint if exists booking_series_generate_ahead_check;

alter table public.booking_series
  add constraint booking_series_generate_ahead_check
  check (generate_ahead > 0 and generate_ahead <= 520);
