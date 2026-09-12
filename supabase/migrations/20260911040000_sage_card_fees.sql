-- ============================================================
-- Card fees reach Sage
-- ============================================================
--
-- A card receipt posts the invoice amount to the bank, but the processor
-- deposits net of its fee, so the bank feed never matched. Each fee now
-- posts a journal: Dr card-processing expense / Cr bank, dated with the
-- payment. Stamped here so it posts once; the reconciler posts any fee
-- that arrived after the receipt did (Stripe reports the fee on a later
-- event than the payment).

alter table public.invoice_payments
  add column if not exists sage_fee_journal_id text;

comment on column public.invoice_payments.sage_fee_journal_id is
  'Sage journal id for this payment''s processor fee (Dr card fees expense / Cr bank). NULL = not posted or no fee.';

notify pgrst, 'reload schema';
