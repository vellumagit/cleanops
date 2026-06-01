-- Pay-rate snapshot at clock-in time.
--
-- Today time_entries has no pay_rate column. Payroll reads it from
-- bookings.hourly_rate_cents (when set) or memberships.pay_rate_cents
-- (the employee's CURRENT rate). The current-rate path is wrong:
-- when an employee's rate changes — a raise, a demotion, a typo
-- correction — every historical hour they ever worked silently
-- re-prices. A raise this month makes last month's payroll wrong.
--
-- This migration adds a per-row snapshot. New clock-in/clock-out
-- entries populate it from the employee's pay_rate_cents at the
-- moment they clocked in. Read paths prefer the snapshot and fall
-- back to the current rate for legacy rows (snapshot IS NULL).
--
-- We do NOT backfill legacy rows. There's no rate-change audit log
-- we could derive historical rates from, so any backfill would be
-- guessing. Existing payroll for legacy hours continues to use the
-- current-rate path (its previous behavior). New hours get the
-- snapshot. Net effect: the bug stops growing today; existing
-- exposure stays bounded.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS pay_rate_cents_snapshot integer
    CHECK (pay_rate_cents_snapshot IS NULL OR pay_rate_cents_snapshot >= 0);

COMMENT ON COLUMN public.time_entries.pay_rate_cents_snapshot IS
  'Hourly rate (in cents) for the employee at the moment this entry was created. NULL on legacy rows; read paths fall back to memberships.pay_rate_cents.';
