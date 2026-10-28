-- A job's state is now computed from the crew's shifts and the schedule
-- (src/lib/job-state.ts). The one thing that can't be computed is a person
-- deciding "this job is over": a manager closing it with a no-show still
-- rostered, or closing a job nobody ever clocked in on. That decision gets
-- its own columns, so it isn't confused with the status the computation
-- would have reached on its own.
--
-- status stays as the cached answer the rest of the app reads. closed_at is
-- the human input to that answer.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.memberships (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.closed_at IS
  'When a manager declared the job over. Null means the job closes itself from the crew''s shifts and the schedule.';
COMMENT ON COLUMN public.bookings.closed_by IS
  'The membership that closed it. Null with closed_at set means a system backfill.';

-- Jobs already completed were closed by somebody or something; record that
-- so the computation never reopens history. Backfill marks them closed at
-- their last update, with no closer.
UPDATE public.bookings
   SET closed_at = COALESCE(updated_at, created_at)
 WHERE status = 'completed'
   AND closed_at IS NULL;
