-- Track when we last sent an overdue-reminder email for an invoice so the
-- cron doesn't spam the client every single day. The reminder cron sends
-- at most once per 7-day window per invoice, until the invoice is paid.
--
-- Idempotent — safe to re-run.

alter table public.invoices
  add column if not exists overdue_reminder_sent_at timestamptz;

comment on column public.invoices.overdue_reminder_sent_at is
  'Timestamp of the last overdue-reminder email sent for this invoice. NULL = never reminded. The cron job at /api/cron/invoice-overdue only sends a fresh reminder if this is NULL or older than 7 days.';

-- Partial index for the cron query: only overdue, unpaid invoices matter.
-- Avoids scanning the whole invoices table daily.
create index if not exists invoices_overdue_reminder_lookup_idx
  on public.invoices (overdue_reminder_sent_at nulls first)
  where status = 'overdue' and paid_at is null;
