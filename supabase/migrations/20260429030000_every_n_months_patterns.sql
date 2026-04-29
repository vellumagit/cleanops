-- Add every_2_months, every_3_months, every_6_months recurrence patterns.
--
-- Common for cleaning businesses: bimonthly (every other month), quarterly
-- deep cleans, semi-annual visits. All three use the same day-of-month logic
-- as 'monthly' but advance by 2, 3, or 6 months respectively.
--
-- Drops and re-adds the check constraint — idempotent.

ALTER TABLE public.booking_series
  DROP CONSTRAINT IF EXISTS booking_series_pattern_check;

ALTER TABLE public.booking_series
  ADD CONSTRAINT booking_series_pattern_check
  CHECK (pattern IN (
    'weekly',
    'bi_weekly',
    'tri_weekly',
    'quad_weekly',
    'monthly',
    'monthly_nth',
    'custom_weekly',
    'every_2_months',
    'every_3_months',
    'every_6_months'
  ));
