-- =============================================================================
-- Job watch: the alerts for a job that passed in silence
-- supabase/migrations/20260816010000_job_watch.sql
-- =============================================================================
-- Sollos notices a job nobody was ASSIGNED to, and a shift nobody clocked OUT
-- of. It never noticed the job in between: assigned, came and went, and no
-- clock-in, no status change, no human touch at all. That job auto-completes
-- on schedule and drafts an invoice, and the first person to find out nothing
-- happened is the client reading the bill.
--
-- Two new words, each said at most once per booking (hence the stamps):
--
--   job_not_started  the start time passed with no clock-in and the window is
--                    still open — nudge the cleaner while being there is still
--                    possible.
--   job_no_clock_in  the whole window passed with no clock-in — the office has
--                    to decide whether it happened BEFORE the money moves.
--
-- notifications.type is an ENUM: a type the app sends but the enum lacks fails
-- the insert with 22P02, and notify() swallows it twice over — which is how
-- seven notification types were silently dead until 20260801010000 found them.
-- So both values are added here, before any code sends them. ALTER TYPE ...
-- ADD VALUE cannot run inside a transaction block, hence the DO blocks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'job_not_started'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'job_not_started';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.notification_type'::regtype
      AND enumlabel = 'job_no_clock_in'
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'job_no_clock_in';
  END IF;
END $$;

-- -- Dedup stamps -------------------------------------------------------------
-- One nudge and one flag per booking. Separate columns because they are
-- different questions to different people: a cleaner who was nudged at 5:15
-- must still produce an office flag at 7:30 if they never showed.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS no_show_nudge_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_clock_in_flagged_at timestamptz;

COMMENT ON COLUMN public.bookings.no_show_nudge_sent_at IS
  'When the assigned crew was nudged that the job start passed with no clock-in. Set once; keeps the every-30-minutes watcher from nagging.';
COMMENT ON COLUMN public.bookings.no_clock_in_flagged_at IS
  'When management was told this job''s whole window passed with no clock-in. Set once. Independent of the nudge stamp — a nudged no-show still needs the office flag.';

-- The watcher's hot path: recent, non-terminal, unflagged bookings.
CREATE INDEX IF NOT EXISTS bookings_job_watch_idx
  ON public.bookings (organization_id, scheduled_at)
  WHERE status IN ('confirmed', 'in_progress');

-- -- Automation toggles -------------------------------------------------------
-- Automations are strict opt-in (resolveAutomationEnabled: an absent key is
-- FALSE), so a new key is born disabled for every existing org. That is
-- exactly how the clock-out guardrail ended up silently off for six of seven
-- orgs — migration 20260723010000 grandfathered a key list written before the
-- feature existed, and #82 ("clock-out timer not stopping") was really "nobody
-- ever turned it on".
--
-- These are owner-facing safety alerts, not client messages, so existing orgs
-- get them ON. The `if not (merged ? k)` guard means an explicit opt-out set
-- later is never overridden, and re-running this file changes nothing.

DO $$
DECLARE
  new_keys text[] := array['job_not_started_nudge', 'no_clock_in_alert'];
  org record;
  k text;
  merged jsonb;
BEGIN
  FOR org IN
    SELECT id, coalesce(automation_settings, '{}'::jsonb) AS settings
    FROM public.organizations
    WHERE deleted_at IS NULL
  LOOP
    merged := org.settings;
    FOREACH k IN ARRAY new_keys LOOP
      IF NOT (merged ? k) THEN
        merged := jsonb_set(
          merged,
          array[k],
          jsonb_build_object('enabled', true),
          true
        );
      END IF;
    END LOOP;

    UPDATE public.organizations
       SET automation_settings = merged
     WHERE id = org.id;
  END LOOP;
END $$;

notify pgrst, 'reload schema';
