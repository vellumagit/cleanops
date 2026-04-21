-- Recurrence improvements:
--
--   1. skip_dates — an array of dates to skip when generating occurrences
--      for the series. Used for one-off holiday exceptions ("no clean on
--      Dec 25"). When an admin skips a single occurrence from the booking
--      edit page, that date gets added here so the nightly extend cron
--      doesn't regenerate it.
--
-- generate_ahead stays as-is but is now used ONLY as the batch size for
-- the extend cron — the UI no longer exposes it. An existing series
-- continues forever unless ends_at is set.
--
-- Idempotent — safe to re-run.

alter table public.booking_series
  add column if not exists skip_dates date[] not null default '{}'::date[];

comment on column public.booking_series.skip_dates is
  'One-off dates to skip when generating occurrences — holidays, client out of town, etc. Any generated date matching a value in this array is silently dropped. Populated by the admin via the "Skip this date" action on a booking.';
