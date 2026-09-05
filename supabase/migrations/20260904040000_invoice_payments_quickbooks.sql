-- ============================================================
-- Payments reach QuickBooks too
-- ============================================================
--
-- Same shape as 20260904030000 for Sage: the QuickBooks Payment id is
-- stamped on the Sollos payment once the receipt is created and applied
-- to the invoice. NULL = not yet in QuickBooks; the reconciler's key.

alter table public.invoice_payments
  add column if not exists quickbooks_payment_id text;

create index if not exists invoice_payments_qbo_pending_idx
  on public.invoice_payments (organization_id, created_at desc)
  where quickbooks_payment_id is null;

comment on column public.invoice_payments.quickbooks_payment_id is
  'QuickBooks Online Payment id once this payment has been pushed and applied to the invoice. NULL = not yet in QuickBooks.';

notify pgrst, 'reload schema';
