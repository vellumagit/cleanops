-- =============================================================================
-- Invoices go out on a rhythm you choose, not just "tomorrow"
-- supabase/migrations/20260903010000_invoice_send_rhythm.sql
-- =============================================================================
-- Auto-send had exactly one shape: the configured hour on the day AFTER a
-- draft is created. That is a good default and a poor rule for an owner who
-- would rather review the week's invoices once and send them together.
--
-- Three modes now, all landing on the SAME configured hour so the clock time
-- stays predictable:
--
--   next_day     unchanged, and still the default — nothing moves for anyone
--                who has auto-send on today.
--   delay_hours  at least N hours of review, then the next time the clock
--                reaches the send hour. "48 hours after" in plain terms.
--   weekday      every Friday (or any day) at the send hour, whatever day the
--                draft was raised.
--
-- This governs the PER-JOB drafts — "everyone else". Clients on a weekly,
-- biweekly or monthly billing cadence already have their own rhythm, and
-- invoice_auto_send_consolidated stays their separate opt-out.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invoice_auto_send_mode text NOT NULL DEFAULT 'next_day'
    CHECK (invoice_auto_send_mode IN ('next_day', 'delay_hours', 'weekday'));

-- 1..168 = an hour to a week. Wider than anyone needs, narrow enough that a
-- fat-fingered 10000 can't park an invoice past the heat death of the sun.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invoice_auto_send_delay_hours integer
    CHECK (invoice_auto_send_delay_hours IS NULL
           OR (invoice_auto_send_delay_hours BETWEEN 1 AND 168));

-- 0 = Sunday … 6 = Saturday, matching JS getDay() so no translation layer
-- can drift.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invoice_auto_send_weekday smallint
    CHECK (invoice_auto_send_weekday IS NULL
           OR (invoice_auto_send_weekday BETWEEN 0 AND 6));

COMMENT ON COLUMN public.organizations.invoice_auto_send_mode IS
  'When per-job invoice drafts auto-send: next_day (default, the send hour tomorrow), delay_hours (>= N hours review, then the next send hour), or weekday (every chosen weekday at the send hour). Clients on a billing cadence are governed by invoice_auto_send_consolidated instead.';

NOTIFY pgrst, 'reload schema';
