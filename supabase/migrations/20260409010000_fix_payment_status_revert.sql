-- -----------------------------------------------------------------------------
-- Bug fix: status not reverting when all payments are deleted
--
-- The sync trigger's "no payments" branch was reading the current status
-- from the invoices row and keeping it — which left the status stuck on
-- `partially_paid` after all payments were deleted. Fix: when v_paid = 0,
-- fall back to the status the invoice SHOULD be in based on its lifecycle:
--   • voided_at set → void (already handled above)
--   • sent_at set + overdue → overdue
--   • sent_at set → sent
--   • else → draft
-- -----------------------------------------------------------------------------

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
  v_status     public.invoice_status;
  v_paid_at    timestamptz;
  v_due_date   date;
  v_voided_at  timestamptz;
  v_sent_at    timestamptz;
begin
  -- Figure out which invoice row this change touched.
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

  select coalesce(sum(amount_cents), 0)
    into v_paid
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
