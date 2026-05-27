-- Prevent double clock-in via a partial unique index.
--
-- The clock-in action does SELECT (check open entry) → INSERT, which is
-- non-atomic. Two simultaneous form submissions (rage-tap, SW retry on
-- a slow network) can both pass the check and both INSERT — leaving the
-- employee with two open time_entries and double-counted payroll hours.
--
-- A partial unique index on (employee_id) WHERE clock_out_at IS NULL
-- enforces "at most one open entry per employee" at the DB level. The
-- second concurrent insert gets a 23505 unique_violation which the
-- action treats as "already clocked in."

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_per_employee_idx
  ON public.time_entries (employee_id)
  WHERE clock_out_at IS NULL;
