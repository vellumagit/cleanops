-- ============================================================
-- Payments reach Sage too
-- ============================================================
--
-- Invoices and contacts synced to Sage; payments never did, so every paid
-- invoice sat in Sage as an open receivable and someone had to key the
-- receipt by hand. Brian, 2026-09-04: "build payment sync."
--
-- One column: the Sage contact_payment id, stamped when the receipt is
-- created. Idempotency key for the push and for the reconciler, same
-- pattern as invoices.sage_invoice_id / clients.sage_contact_id.

alter table public.invoice_payments
  add column if not exists sage_payment_id text;

create index if not exists invoice_payments_sage_pending_idx
  on public.invoice_payments (organization_id, created_at desc)
  where sage_payment_id is null;

comment on column public.invoice_payments.sage_payment_id is
  'Sage Accounting contact_payment id once this payment has been pushed as a customer receipt allocated to the invoice. NULL = not yet in Sage.';

notify pgrst, 'reload schema';
