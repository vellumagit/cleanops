-- ============================================================
-- Contractors become Sage suppliers; statements become bills
-- ============================================================
--
-- Sage Accounting has no employees, only customers and suppliers. A
-- subcontractor is genuinely a supplier — they bill the business, the
-- business pays them — so each contractor gets a supplier contact, each
-- finalized statement line becomes a purchase invoice against them, and
-- marking the statement paid records the supplier payment. That is the
-- "who am I paying what" view a bookkeeper already knows how to read.
-- Employees stay a gross-wages journal (20260911010000).

alter table public.memberships
  add column if not exists sage_contact_id text;

comment on column public.memberships.sage_contact_id is
  'Sage Accounting supplier (VENDOR) contact id for a subcontractor. NULL = not created in Sage yet.';

alter table public.subcontractor_pay_items
  add column if not exists sage_purchase_invoice_id text,
  add column if not exists sage_payment_id text;

comment on column public.subcontractor_pay_items.sage_purchase_invoice_id is
  'Sage purchase invoice (bill) id for this contractor''s line on the statement. NULL = not posted.';
comment on column public.subcontractor_pay_items.sage_payment_id is
  'Sage supplier payment id once the statement was marked paid and the bill settled. NULL = not posted.';

create index if not exists subcontractor_pay_items_sage_pending_idx
  on public.subcontractor_pay_items (run_id)
  where sage_purchase_invoice_id is null or sage_payment_id is null;

notify pgrst, 'reload schema';
