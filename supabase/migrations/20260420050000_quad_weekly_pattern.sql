-- Add 'quad_weekly' (every 4 weeks, 28-day cadence) to booking_series.pattern.
--
-- Distinct from 'monthly' because calendar months are 28-31 days, so
-- 'monthly' drifts (12 occurrences/year) while 'quad_weekly' is a pure
-- 28-day cycle (13 occurrences/year). Cleaning businesses often want the
-- latter for deep-clean cadences.
--
-- Drops and re-adds the check constraint so the allowed set is clean.
-- Idempotent — safe to re-run.

alter table public.booking_series
  drop constraint if exists booking_series_pattern_check;

alter table public.booking_series
  add constraint booking_series_pattern_check
  check (pattern in (
    'weekly',
    'bi_weekly',
    'tri_weekly',
    'quad_weekly',
    'monthly',
    'monthly_nth',
    'custom_weekly'
  ));
