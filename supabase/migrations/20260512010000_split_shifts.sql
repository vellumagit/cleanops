-- Split shifts
--
-- Allows a single booking to be divided into time segments, each assigned to
-- a different employee with their own hourly rate.
--
-- Schema:
--   bookings.splits  JSONB[]   — array of split segments
--
-- Each segment:
--   {
--     "id":                   "uuid",          -- stable key for React rendering
--     "assigned_to":          "membership_id", -- who covers this segment
--     "start_offset_minutes": 0,               -- minutes after booking start
--     "duration_minutes":     420,             -- length of this segment
--     "hourly_rate_cents":    2500             -- rate for this employee on this booking
--   }
--
-- The parent booking keeps the full duration_minutes, client, billing total, etc.
-- When splits are set, booking.assigned_to is treated as the primary/lead and
-- the splits array is the authoritative assignment list.
--
-- Idempotent — safe to re-run.

alter table public.bookings
  add column if not exists splits jsonb not null default '[]'::jsonb;

comment on column public.bookings.splits is
  'Split-shift segments. Each element: {id, assigned_to, start_offset_minutes, duration_minutes, hourly_rate_cents}. Empty array = no split. When non-empty the booking covers multiple employees working sequential time windows.';
