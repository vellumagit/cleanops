-- A notification type for things a client asks for.
--
-- MUST RUN BEFORE THE CODE THAT USES IT DEPLOYS. notify() wraps its whole body
-- in try/catch and the push send sits after the insert inside that same block,
-- so an unlisted enum value fails 22P02, gets swallowed, and writes no row AND
-- sends no push. That is exactly how seven notification types stayed dead for
-- months before 20260801010000 added them.
--
-- WHY NOT REUSE 'general'.
-- notifyUpcomingJobs dedupes the cleaner's "job starting soon" push by
-- selecting every notification with type='general' from the last two hours
-- (cross-org, limit 500) and keying on the LAST PATH SEGMENT of href
-- (src/lib/automations.ts:640-652). A client note stored as 'general' with
-- href='/field/jobs/<booking id>' therefore lands in that Set and SUPPRESSES
-- the pre-arrival push for that exact booking — a client leaving a note forty
-- minutes before their visit would cancel the cleaner's reminder for the visit
-- the note is about. 'general' is not untidy here, it is actively wrong.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, hence the
-- conditional DO block rather than a plain statement. Matches 20260801010000.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'client_request'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'client_request';
  END IF;
END $$;
