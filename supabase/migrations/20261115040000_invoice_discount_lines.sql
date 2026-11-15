-- =============================================================================
-- Invoices can carry a discount line
-- =============================================================================
-- 2026-11-15, Svit: a $200 discount on a move-out clean, entered as a line
-- at -200, was refused ("Price must be > 0"). Invoices never had a discount:
-- invoice_line_items.unit_price_cents has refused anything below zero since
-- the table was made.
--
-- A discount is now a line with a negative price. Everything that adds up
-- lines (the invoice save, the PDF, the client's page, the books sync) adds
-- it the right way without change, and tax is worked out on the total after
-- it. Two rules stay with the database:
--
--   * A discount line names no job. A job's line is what marks it billed
--     (billed-bookings.ts); a negative line holding a job would read as
--     billing it for less than nothing.
--   * The invoice total stays above zero: invoices.amount_cents already
--     checks > 0, so discounts larger than the rest of the invoice are
--     refused there, and the app says so in words first
--     (src/lib/invoice-line-items.ts).
--
-- Run BEFORE the push: until it runs the database still refuses a negative
-- line, so a discount saved from the new form would fail. Safe to run more
-- than once.
-- =============================================================================

begin;

alter table public.invoice_line_items
  drop constraint if exists invoice_line_items_unit_price_cents_check;

alter table public.invoice_line_items
  drop constraint if exists invoice_line_items_discount_names_no_job;

alter table public.invoice_line_items
  add constraint invoice_line_items_discount_names_no_job
    check (unit_price_cents >= 0 or booking_id is null);

commit;
