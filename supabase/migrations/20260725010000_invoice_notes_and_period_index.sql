-- =============================================================================
-- Audit Tranche 1: invoices.notes + re-billable voided periods
-- =============================================================================
-- 1. `invoices.notes` — BOTH the recurring-invoice generator and the flat-rate
--    consolidated billing path have been inserting a `notes` value since they
--    shipped, but the column never existed, so PostgREST rejected every insert
--    (PGRST204) and NO invoice was ever created by either path (audit C1/C2).
--    The code now inserts without notes and applies them as a separate
--    best-effort UPDATE, so code and migration can deploy in either order.
--
-- 2. Period-key unique index becomes partial on voided_at — voiding a
--    consolidated invoice previously left the (client, period) key occupied
--    forever, so the billing cron could never re-bill that period (audit P4).
--    The void action now also un-stamps the bookings.
-- =============================================================================

alter table public.invoices
  add column if not exists notes text;

comment on column public.invoices.notes is
  'Free-text notes shown with the invoice (e.g. flat-rate period coverage, recurring-series notes).';

drop index if exists public.invoices_client_billing_period_uidx;
create unique index if not exists invoices_client_billing_period_uidx
  on public.invoices (client_id, billing_period_key)
  where billing_period_key is not null and voided_at is null;
