-- A visit's time was set by a person, on purpose.
--
-- A recurring series is the INTENT ("every other Monday at 9:00 AM Edmonton");
-- each generated visit is a copy of it, stored as an exact instant. When the
-- rules behind that instant change — Alberta stopped changing its clocks on
-- 2026-11-01, and the server ran the old rules until about 2026-09-29 — the
-- copies go stale while the series stays right. Nothing compared them: 115
-- Svit winter visits sat an hour late with nothing on screen to say so.
--
-- The drift check (src/lib/series-drift.ts) compares every future visit to
-- its series under the current rules and asks the office about the ones that
-- differ. It needs one thing to stay quiet about the right ones: whether a
-- person moved the visit by hand. That is this column. The edit form, the
-- calendar drag and the API set it whenever a human changes scheduled_at;
-- "Keep these times" on the dashboard sets it too. A visit with it set is
-- hers; a visit without it is the series', and may be restored.
--
-- No backfill: nothing recorded past hand moves (no reschedule notice was
-- ever sent for a future series visit, and the audit log holds none), so
-- every existing visit starts as "the series'" and the office decides once.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS time_set_by_hand_at timestamptz;

COMMENT ON COLUMN public.bookings.time_set_by_hand_at IS
  'When a person last set this visit''s time deliberately (edit form, calendar drag, API, or "Keep these times"). Null means the time is the series'' and the drift check may restore it.';
