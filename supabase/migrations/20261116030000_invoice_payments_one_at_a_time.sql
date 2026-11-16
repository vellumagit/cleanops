-- =============================================================================
-- Payments on one invoice are totalled one at a time
-- =============================================================================
-- Found 2026-11-15 by the load tests (test/load/money.load.test.ts), on a real
-- PostgreSQL server: two $100 payments recorded at the same moment on a $200
-- invoice left it "partially_paid", with $200 paid. Through the app too, not
-- only when stepped by hand.
--
-- sync_invoice_payment_totals() runs after each payment is saved: it reads
-- the invoice, adds up its payments, and writes the status. Two payments in
-- the same moment each add up only their own (the other is not committed
-- yet), each decide "partially paid", and whichever writes last wins. An
-- invoice paid in full then shows a balance, and the overdue reminders keep
-- going to a client who has paid. Two payments can land together when two
-- people record them, or when a card payment's webhook arrives while someone
-- records one by hand.
--
-- The one change: the invoice is read FOR NO KEY UPDATE. A second payment's
-- trigger waits for the first to commit, then adds up both (each statement in
-- this VOLATILE plpgsql function takes a fresh snapshot). Different invoices
-- never wait for each other. Everything else is the 20260714010000
-- definition, unchanged.
--
-- NO KEY UPDATE, not UPDATE: saving a payment already holds a KEY SHARE lock
-- on its invoice (the foreign-key check). FOR UPDATE conflicts with that, so
-- two payments each holding KEY SHARE and each asking for UPDATE deadlocked
-- (seen in the load tests, 40P01: one payment refused). NO KEY UPDATE does
-- not conflict with KEY SHARE, and is what the UPDATE at the end takes anyway.
--
-- No data changes. Safe to run more than once. Run BEFORE the push.
-- =============================================================================

begin;

create or replace function public.sync_invoice_payment_totals()
returns trigger
language plpgsql
volatile
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

  -- One payment's totals at a time per invoice (see above).
  select amount_cents, due_date, voided_at, sent_at
    into v_total, v_due_date, v_voided_at, v_sent_at
    from public.invoices
   where id = v_invoice_id
   for no key update;

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

commit;
