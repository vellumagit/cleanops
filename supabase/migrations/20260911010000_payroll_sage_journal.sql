-- ============================================================
-- Paid payroll reaches Sage as a journal
-- ============================================================
--
-- Invoices, contacts and receipts sync to Sage Accounting; wages never did,
-- so the biggest expense in a cleaning business sat outside the books until
-- someone keyed it. Brian, 2026-09-11: "round out Sage Accounting so people
-- can track their payroll too."
--
-- One Sage journal per paid run (employee run or contractor statement):
-- debit the wages / subcontractor expense per person, credit a wages-
-- payable liability for the total. The journal id is stamped here; NULL
-- means the reconciler still owes Sage this run.

alter table public.payroll_runs
  add column if not exists sage_journal_id text;

alter table public.subcontractor_pay_runs
  add column if not exists sage_journal_id text;

comment on column public.payroll_runs.sage_journal_id is
  'Sage Accounting journal id once this paid run has been posted (gross wages per person, credited to wages payable). NULL = not yet in Sage.';
comment on column public.subcontractor_pay_runs.sage_journal_id is
  'Sage Accounting journal id once this paid statement has been posted (subcontractor cost per person, credited to wages payable). NULL = not yet in Sage.';

notify pgrst, 'reload schema';
