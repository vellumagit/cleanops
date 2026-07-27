-- Invoice auto-send: replace the rolling "N hours after drafting" delay with
-- a predictable org-local clock time — invoices go out at {hour}:00 the day
-- AFTER the job, and the morning review digest gives the owner a heads-up
-- window beforehand. The old delay column stays (harmless) but is no longer
-- read.

alter table public.organizations
  add column if not exists invoice_auto_send_hour smallint not null default 17;

alter table public.organizations
  add constraint organizations_invoice_auto_send_hour_check
  check (invoice_auto_send_hour between 0 and 23);
