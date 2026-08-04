-- A job that has not started yet cannot already be finished.
--
-- On 2026-08-03 booking a766d848 was created for a slot two days out and saved
-- with status='completed'. The field app computes
--   needs_acceptance = acceptance_status = 'pending' AND status <> 'completed'
-- so Jim was never shown the shift at all — no accept prompt, nothing on his
-- Upcoming tab, no contribution to the "shifts need your confirmation" count.
-- He had a booking_assignees row the whole time. He simply could not see it.
--
-- The application now checks this on all eight write paths (the create and
-- edit forms, the quick-status dropdown, mark-complete, the drag-reschedule,
-- both /api/v1 routes, and the field app's start + complete). That is eight
-- places that must each stay correct forever, and it still leaves scripts,
-- seeds, and anything typed into the SQL editor free to write the bad shape.
-- This trigger is the one place the invariant actually lives.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
-- A CHECK cannot call now() — constraint expressions must be IMMUTABLE, and a
-- row's validity here depends on when you ask.
--
-- THE GRACE WINDOW
-- The rule is not "not in the future" but "not FAR in the future". A cleaner
-- who finishes one job early and clocks into the next before its scheduled
-- hour is doing nothing wrong, and on a short job can even finish before the
-- slot starts. Four hours covers any real early arrival while still catching
-- a766d848, which was fifty hours out. Keep this in step with
-- EARLY_START_GRACE_MINUTES in src/lib/booking-status.ts — the two layers
-- encode the same rule and are meant to agree.
--
-- Back-filling is untouched: a past date with any status passes.

CREATE OR REPLACE FUNCTION public.bookings_reject_premature_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed', 'in_progress')
     AND NEW.scheduled_at > now() + interval '4 hours' THEN
    RAISE EXCEPTION
      'Booking % is scheduled for % — too far ahead to be marked %.',
      COALESCE(NEW.id::text, 'new'), NEW.scheduled_at, NEW.status
      USING ERRCODE = 'check_violation',
            HINT = 'Save it as confirmed; it can be started once it is due.';
  END IF;
  RETURN NEW;
END;
$$;

-- Fires on INSERT, and on UPDATE only when one of the two columns the rule
-- depends on actually moves — so unrelated edits (price, notes, assignee) on
-- an already-running job never pay for this check.
DROP TRIGGER IF EXISTS bookings_reject_premature_status_trg ON public.bookings;

CREATE TRIGGER bookings_reject_premature_status_trg
  BEFORE INSERT OR UPDATE OF status, scheduled_at ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_reject_premature_status();

COMMENT ON FUNCTION public.bookings_reject_premature_status() IS
  'Rejects completed/in_progress on a booking scheduled more than 4h out. Mirrors futureStatusError in src/lib/booking-status.ts. See migration 20260804010000.';
