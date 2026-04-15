-- =============================================================================
-- Add "Nth weekday of month" recurrence pattern
-- =============================================================================
-- Example: "every 2nd Tuesday" or "last Friday of every month".
-- Existing patterns (weekly / bi_weekly / tri_weekly / monthly / custom_weekly)
-- keep working — we add a new pattern value 'monthly_nth' plus two columns
-- to store the ordinal + weekday.
-- =============================================================================

-- 1. Relax the check constraint to include the new pattern.
ALTER TABLE public.booking_series
  DROP CONSTRAINT IF EXISTS booking_series_pattern_check;

ALTER TABLE public.booking_series
  ADD CONSTRAINT booking_series_pattern_check
  CHECK (pattern IN ('weekly', 'bi_weekly', 'tri_weekly', 'monthly', 'custom_weekly', 'monthly_nth'));

-- 2. Add the ordinal + weekday columns. NULL unless pattern = 'monthly_nth'.
ALTER TABLE public.booking_series
  ADD COLUMN IF NOT EXISTS monthly_nth smallint
    CHECK (monthly_nth IS NULL OR (monthly_nth BETWEEN 1 AND 5)),
  ADD COLUMN IF NOT EXISTS monthly_dow smallint
    CHECK (monthly_dow IS NULL OR (monthly_dow BETWEEN 0 AND 6));

COMMENT ON COLUMN public.booking_series.monthly_nth IS
  'For monthly_nth pattern: 1=1st, 2=2nd, 3=3rd, 4=4th, 5=last.';
COMMENT ON COLUMN public.booking_series.monthly_dow IS
  'For monthly_nth pattern: day of week (0=Sun .. 6=Sat).';
