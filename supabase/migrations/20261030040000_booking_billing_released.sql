-- =============================================================================
-- A person voided this job's invoice, so nothing bills it again by itself
-- =============================================================================
-- Voiding an invoice clears the job's billing stamp, and the billing-cycle
-- cron bills every completed job without a stamp, with no date limit. So work
-- Svitlana voided came straight back on the next run: on 2026-11-01 it would
-- have drafted $3,346.88 for two clients, of which $756 was new work.
--
-- Voiding still frees a job to be billed. It just takes a person now: from the
-- job, or from Bill for a period, which ignore this column.
--
-- MUST run before the code that reads it is pushed. Until it exists, every
-- auto-drafted invoice fails to load its booking.
-- =============================================================================

alter table public.bookings
  add column if not exists billing_released_at timestamptz;

comment on column public.bookings.billing_released_at is
  'When a person voided the invoice billing this job. The billing-cycle cron, Generate all, and auto-drafting leave the job alone from then on. Billing it by hand still works.';
