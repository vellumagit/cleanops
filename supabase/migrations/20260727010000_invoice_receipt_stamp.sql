-- =============================================================================
-- Audit P2/P7: idempotency stamp for the "invoice paid" client emails
-- =============================================================================
-- autoOnInvoicePaid (receipt + review request) is now also triggered by the
-- Stripe/Square payment webhooks, not just the manual mark-paid action — so it
-- needs a claim stamp to guarantee the client gets the bundle at most ONCE,
-- however many payment events arrive (webhook retries, corrections, an owner
-- also recording the payment by hand).
-- =============================================================================

alter table public.invoices
  add column if not exists receipt_sent_at timestamptz;

comment on column public.invoices.receipt_sent_at is
  'When the paid-receipt/review-request bundle was claimed for this invoice. CAS-claimed before sending; at most one send ever.';
