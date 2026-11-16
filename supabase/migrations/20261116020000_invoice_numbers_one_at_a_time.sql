-- =============================================================================
-- Invoice numbers are chosen one at a time per company
-- =============================================================================
-- Found 2026-11-15 by the first load test (test/load/races.load.test.ts), on a
-- real PostgreSQL server: ten jobs in one company finishing at the same
-- moment drafted two invoices, not ten.
--
-- assign_invoice_number() picks the company's highest number this year plus
-- one. Two invoices inserted at the same moment both read the same highest
-- number and both pick the next one; the unique index on
-- (organization_id, number) refuses the second. The comment on the original
-- called that index "the final race guard", but the code that drafts an
-- invoice when a job finishes (autoInvoiceOnJobComplete) does not try again:
-- it logs the refusal and returns. The job stays completed with no invoice,
-- and nothing tells anyone.
--
-- Now the trigger takes a lock for the company before it reads the highest
-- number, held until the inserting transaction ends. A second invoice for
-- the same company waits a moment, then reads a number that includes the
-- first. Different companies never wait for each other. The lock key is the
-- company id hashed with its own seed, so it never shares a lock with the
-- schedule guard (lock_booking_schedule_writes, seed 4815162342).
--
-- The SELECT below sees the first invoice once it has committed: in a
-- VOLATILE plpgsql function each statement takes a fresh snapshot.
--
-- No data changes. Safe to run more than once. Run BEFORE the push.
-- =============================================================================

begin;

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_prefix text := 'INV-' || v_year::text || '-';
  v_next int;
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;

  -- One invoice number at a time per company, until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 2718281828));

  select coalesce(
           max(
             nullif(
               regexp_replace(number, '^' || v_prefix, ''),
               ''
             )::int
           ),
           0
         ) + 1
    into v_next
    from public.invoices
   where organization_id = new.organization_id
     and number like v_prefix || '%';

  new.number := v_prefix || lpad(v_next::text, 4, '0');
  return new;
end;
$$;

commit;
