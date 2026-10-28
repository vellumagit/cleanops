-- The wall clock is the truth; the instant is a cache.
--
-- bookings.scheduled_at (an exact instant) is what every query, cron and
-- calendar reads, and it stays. But it is DERIVED: a person booked "Dec 7 at
-- 9:00 AM Edmonton", and turning that into an instant needs the zone's rules
-- for Dec 7. Those rules can change after the fact — Alberta stopped changing
-- its clocks from 2026-11-01, the server learned on ~2026-09-29, and every
-- winter visit converted before then sits an hour late. The typed time was
-- never stored, so nothing could re-derive it.
--
-- Now it is. scheduled_local holds the wall clock as typed ("2026-12-07T09:00")
-- and scheduled_tz the zone it was typed in. The nightly job
-- (src/lib/scheduled-local-job.ts) re-derives scheduled_at from them for every
-- future visit under the runtime's current rules, so a rule change corrects
-- itself the next night, with an audit row per visit. Writers that know the
-- wall clock (the booking form, the calendar drag, the series generator) set
-- all three; the trigger below fills the wall clock in for any writer that
-- only knows the instant (the API, duplicates, the Restore button), deriving
-- it under the rules in force at that moment — which is exactly what the
-- writer meant.
--
-- America/Edmonton is special-cased to America/Regina for instants on or after
-- 2026-11-01 08:00 UTC: the two zones are identical from then on (UTC-6, no
-- changes), and this does not depend on which tzdata this Postgres carries.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS scheduled_local text,
  ADD COLUMN IF NOT EXISTS scheduled_tz text;

COMMENT ON COLUMN public.bookings.scheduled_local IS
  'The visit''s start as a wall clock in scheduled_tz, "YYYY-MM-DDTHH:MM", as a person booked it. The source of truth; scheduled_at is derived from it nightly.';
COMMENT ON COLUMN public.bookings.scheduled_tz IS
  'IANA zone scheduled_local is read in. The org''s zone when the visit was booked.';

-- Instant -> wall clock, robust to this Postgres' tzdata for Alberta.
CREATE OR REPLACE FUNCTION public.booking_wall_clock_local(ts timestamptz, tz text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_char(
    ts AT TIME ZONE (
      CASE
        WHEN tz = 'America/Edmonton' AND ts >= '2026-11-01 08:00:00+00'::timestamptz
          THEN 'America/Regina'
        ELSE tz
      END
    ),
    'YYYY-MM-DD"T"HH24:MI'
  );
$$;

-- Backfill: what each existing visit's instant reads as, in its org's zone,
-- under correct rules. For visits generated on stale rules this records the
-- wrong hour as if typed — those are found and fixed once through the series
-- drift list (src/lib/series-drift.ts); from then on the model self-heals.
UPDATE public.bookings b
SET scheduled_tz = COALESCE(o.timezone, 'America/Edmonton'),
    scheduled_local = public.booking_wall_clock_local(b.scheduled_at, COALESCE(o.timezone, 'America/Edmonton'))
FROM public.organizations o
WHERE o.id = b.organization_id
  AND b.scheduled_local IS NULL;

-- Keep the wall clock present and consistent for writers that only set the
-- instant. INSERT with no wall clock: derive it. UPDATE that moves the instant
-- without saying the wall clock: derive it. A writer that sets both is
-- believed as-is.
CREATE OR REPLACE FUNCTION public.bookings_keep_wall_clock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_tz text;
BEGIN
  IF NEW.scheduled_tz IS NULL THEN
    SELECT COALESCE(timezone, 'America/Edmonton') INTO org_tz
      FROM public.organizations WHERE id = NEW.organization_id;
    NEW.scheduled_tz := COALESCE(org_tz, 'America/Edmonton');
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_local IS NULL THEN
      NEW.scheduled_local := public.booking_wall_clock_local(NEW.scheduled_at, NEW.scheduled_tz);
    END IF;
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
        AND NEW.scheduled_local IS NOT DISTINCT FROM OLD.scheduled_local THEN
    NEW.scheduled_local := public.booking_wall_clock_local(NEW.scheduled_at, NEW.scheduled_tz);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_keep_wall_clock_trg ON public.bookings;
CREATE TRIGGER bookings_keep_wall_clock_trg
  BEFORE INSERT OR UPDATE OF scheduled_at, scheduled_local, scheduled_tz ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_keep_wall_clock();
