-- A notification type for the feedback board.
--
-- MUST RUN BEFORE THE CODE THAT USES IT DEPLOYS. notify() wraps its whole body
-- in try/catch, so an unlisted enum value fails 22P02, gets swallowed, and
-- writes no row AND sends no push — the exact failure mode documented in
-- 20260801010000 and 20260806010000.
--
-- WHY NOT REUSE 'general'. notifyUpcomingJobs dedupes the cleaner's
-- "job starting soon" push by scanning every type='general' notification from
-- the last two hours and keying on the LAST PATH SEGMENT of href
-- (src/lib/automations.ts). Feedback hrefs end in a uuid, so a collision is
-- vanishingly unlikely — but the dedupe scan is cross-org and capped at 500
-- rows, so every 'general' row we add shortens the window it can actually see.
-- A busy feedback week should not be able to blind the pre-arrival push.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, hence the
-- conditional DO block rather than a plain statement.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'feedback'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'feedback';
  END IF;
END $$;
