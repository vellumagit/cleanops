-- Money-path hardening. Three coupled changes shipped together because they
-- all touch invoice correctness and the payment-status trigger:
--
--   1. invoice_payments.refunded_cents — lets a refund reduce the recorded
--      NET paid amount without deleting the original payment row (audit trail
--      stays intact) and without violating the amount_cents > 0 check.
--
--   2. sync_invoice_payment_totals() — now computes paid as
--      sum(amount_cents - refunded_cents) and derives a 'refunded' status when
--      a fully-refunded invoice has zero net paid. This keeps the payments
--      ledger the single source of truth for invoice status; the Stripe/Square
--      webhooks just stamp refunded_cents and let the trigger reconcile.
--
--   3. invoices.billing_period_key + unique index — crash-safe idempotency for
--      the billing-cycle cron. A period is billed at most once per client even
--      if the cron dies mid-run (Vercel timeout) after the invoice insert but
--      before stamping bookings — the retry hits the unique violation and
--      skips instead of minting a second invoice for the same period.

-- ---------------------------------------------------------------------------
-- 1. Refund tracking on the payments ledger
-- ---------------------------------------------------------------------------

alter table public.invoice_payments
  add column if not exists refunded_cents integer not null default 0;

-- Per-row invariant: you can't refund more than was captured, and it can't be
-- negative. Guarded with a named constraint so it's idempotent-ish on re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_payments_refunded_cents_chk'
  ) then
    alter table public.invoice_payments
      add constraint invoice_payments_refunded_cents_chk
      check (refunded_cents >= 0 and refunded_cents <= amount_cents);
  end if;
end $$;

comment on column public.invoice_payments.refunded_cents is
  'Cumulative amount refunded against this payment (cents). Set by the Stripe/Square refund webhooks to the processor''s total amount_refunded. Net paid = amount_cents - refunded_cents.';

-- ---------------------------------------------------------------------------
-- 2. Status trigger — net paid + fully-refunded status
-- ---------------------------------------------------------------------------
-- Supersedes the definition from 20260409010000_fix_payment_status_revert.
-- Only two things change vs that version:
--   * v_paid is now NET of refunds (sum of amount_cents - refunded_cents)
--   * a new branch marks the invoice 'refunded' when net paid is zero but
--     money was refunded (distinguishes a refunded invoice from an unpaid one)

create or replace function public.sync_invoice_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_total      integer;
  v_paid       integer;
  v_refunded   integer;
  v_status     public.invoice_status;
  v_paid_at    timestamptz;
  v_due_date   date;
  v_voided_at  timestamptz;
  v_sent_at    timestamptz;
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  if v_invoice_id is null then
    return coalesce(new, old);
  end if;

  select amount_cents, due_date, voided_at, sent_at
    into v_total, v_due_date, v_voided_at, v_sent_at
    from public.invoices
   where id = v_invoice_id;

  if not found then
    return coalesce(new, old);
  end if;

  -- Net paid (refunds reduce it) and total refunded, in one pass.
  select coalesce(sum(amount_cents - refunded_cents), 0),
         coalesce(sum(refunded_cents), 0)
    into v_paid, v_refunded
    from public.invoice_payments
   where invoice_id = v_invoice_id;

  -- Void trumps everything.
  if v_voided_at is not null then
    v_status := 'void';
    v_paid_at := null;
  elsif v_paid >= v_total and v_total > 0 then
    v_status := 'paid';
    select max(received_at) into v_paid_at
      from public.invoice_payments
     where invoice_id = v_invoice_id;
  elsif v_paid > 0 then
    v_status := 'partially_paid';
    v_paid_at := null;
  elsif v_refunded > 0 then
    -- Net paid is zero but money was refunded → the invoice was paid then
    -- fully refunded. Distinct from a never-paid invoice.
    v_status := 'refunded';
    v_paid_at := null;
  else
    -- No payments. Revert to the lifecycle status based on timestamps.
    v_paid_at := null;
    if v_due_date is not null and v_due_date < current_date and v_sent_at is not null then
      v_status := 'overdue';
    elsif v_sent_at is not null then
      v_status := 'sent';
    else
      v_status := 'draft';
    end if;
  end if;

  update public.invoices
     set status = v_status,
         paid_at = v_paid_at,
         updated_at = now()
   where id = v_invoice_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_payments_sync_totals on public.invoice_payments;
create trigger invoice_payments_sync_totals
  after insert or update or delete on public.invoice_payments
  for each row execute function public.sync_invoice_payment_totals();

-- ---------------------------------------------------------------------------
-- 3. Crash-safe billing-cycle idempotency
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists billing_period_key text;

comment on column public.invoices.billing_period_key is
  'Deterministic key for auto-generated billing-cycle invoices (e.g. "monthly:2026-07", "biweekly:2026-07-15"). NULL for manual/recurring-series invoices. The unique index below guarantees a client is billed at most once per period even if the cron retries after a mid-run crash.';

-- One auto-generated invoice per (client, period). Partial so manual invoices
-- (NULL key) are unconstrained.
create unique index if not exists invoices_client_billing_period_uidx
  on public.invoices (client_id, billing_period_key)
  where billing_period_key is not null;

notify pgrst, 'reload schema';
