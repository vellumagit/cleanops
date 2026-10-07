-- The whole crew a recurring series puts on every visit.
--
-- A series template held ONE cleaner (assigned_to), and the extend-series cron
-- built every new visit from it. So a two-person recurring job became a
-- one-person job the moment its series extended past what was already
-- generated, and per-cleaner time windows were dropped with it — invisibly,
-- because the visits already on the calendar still showed the full crew.
--
-- crew is an array of { membership_id, start_offset_minutes, duration_minutes }.
-- Offsets/durations are null for someone on site for the whole visit.
-- Everyone in it is equal; see src/lib/series-crew.ts.
--
-- Nullable and NOT backfilled here on purpose. A series with no crew keeps
-- extending exactly as before, from assigned_to (crewForGeneration falls
-- back to it). It gains a crew the next time it is created or saved with
-- "this and future", so no existing schedule changes behaviour on deploy.
--
-- RUN THIS BEFORE PUSHING the code that writes it. The series save now checks
-- its result and stops on failure, so pushing first would make every
-- "this and future" save fail with "Could not find the 'crew' column".

alter table public.booking_series
  add column if not exists crew jsonb;

comment on column public.booking_series.crew is
  'Everyone on each generated visit: [{membership_id, start_offset_minutes, duration_minutes}]. Null = legacy, extend from assigned_to.';

-- PostgREST caches the schema; without this the new column is invisible to
-- the API until the cache happens to refresh.
notify pgrst, 'reload schema';
