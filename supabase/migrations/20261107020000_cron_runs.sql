-- A ledger of cron runs, so a job that fails or stops running is seen.
--
-- Vercel keeps about fifty log lines per deployment and nobody reads them;
-- a cron that threw every night since Oct 28 (the calendar reconcile, on an
-- ambiguous embed) showed nowhere. Every /api/cron route now records a row
-- per run through withCronRun (src/lib/cron-run.ts): when it started and
-- finished, whether it returned 2xx, the error if not, and its JSON result.
-- The morning check reads the last week of rows and lists what failed and
-- what hasn't run when it should have (section 6); it prunes rows older
-- than 30 days. Auth refusals (401/503) are not runs and are not recorded.

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path        text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  ok          boolean NOT NULL,
  status      integer,
  error       text,
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_runs IS
  'One row per cron run (src/lib/cron-run.ts). Read by the morning check; pruned after 30 days.';

CREATE INDEX IF NOT EXISTS cron_runs_path_started_idx
  ON public.cron_runs (path, started_at DESC);
CREATE INDEX IF NOT EXISTS cron_runs_started_idx
  ON public.cron_runs (started_at DESC);

-- Service role only: no policies, so nothing but the server writes or reads it.
ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;
