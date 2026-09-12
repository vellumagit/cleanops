-- ============================================================
-- Refunds and tips reach Sage
-- ============================================================
--
-- Refunds: a refunded invoice sat Paid in Sage. Each refund now posts a
-- credit note against the invoice's customer and a customer refund from
-- the bank, allocated to it. Refunds accumulate on the payment row as
-- refunded_cents; sage_refunded_cents is how much of that Sage has seen,
-- so a second partial refund posts only the difference.
--
-- Tips: a card tip lands in the bank but is not revenue — it is owed to
-- the cleaner until paid out or kept. On receipt: Dr bank / Cr tips
-- payable. On settlement: Dr tips payable / Cr bank (paid out) or Cr tips
-- income (kept). custody records whether the money ever touched the
-- business: a tip handed straight to the cleaner ("direct") never does
-- and is not posted.

alter table public.invoice_payments
  add column if not exists sage_refunded_cents integer not null default 0
    check (sage_refunded_cents >= 0);

comment on column public.invoice_payments.sage_refunded_cents is
  'How much of refunded_cents has been posted to Sage as a credit note + customer refund. The reconciler posts the difference.';

alter table public.invoice_tips
  add column if not exists custody text not null default 'held'
    check (custody in ('held', 'direct')),
  add column if not exists sage_receipt_journal_id text,
  add column if not exists sage_settle_journal_id text;

comment on column public.invoice_tips.custody is
  'held = the business received the money (card, e-transfer, cash into the till) and owes it; direct = handed to the cleaner, never in the business''s hands. Only held tips are posted to the books.';
comment on column public.invoice_tips.sage_receipt_journal_id is
  'Sage journal recording the tip arriving in the bank as a liability. NULL = not posted.';
comment on column public.invoice_tips.sage_settle_journal_id is
  'Sage journal clearing the liability when the tip was paid out or kept. NULL = not posted (or not yet settled).';

-- Direct tips written before this column existed were stamped paid_out_at
-- at creation with no provider payment behind them; leave them held — the
-- reconciler only posts held tips that are UNSETTLED or settled by an
-- owner action, and those rows predate both.

notify pgrst, 'reload schema';
