-- Money a client paid BEFORE their job was invoiced.
--
-- Sollos only invoices a completed job, so a client who paid the day before
-- (Sylvia, 2026-10-15) had nothing to record the payment against. A
-- prepayment sits on the booking until an invoice for that job exists, then
-- becomes an ordinary invoice_payments row on it — per-job invoice or a
-- period invoice the job is billed on. See src/lib/booking-prepayments.ts.
--
-- booking_id is SET NULL, not CASCADE: a series edit regenerates future
-- visits by deleting them, and money must never vanish with a row. client_id
-- keeps an orphaned prepayment findable.

create table if not exists public.booking_prepayments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  booking_id          uuid references public.bookings(id) on delete set null,
  client_id           uuid references public.clients(id) on delete set null,
  amount_cents        integer not null check (amount_cents > 0),
  method              public.payment_method not null,
  reference           text check (reference is null or length(reference) <= 200),
  notes               text check (notes is null or length(notes) <= 1000),
  received_at         timestamptz not null,
  recorded_by         uuid references public.memberships(id) on delete set null,
  -- Set once the money has moved onto an invoice.
  applied_at          timestamptz,
  applied_invoice_id  uuid references public.invoices(id) on delete set null,
  applied_payment_id  uuid references public.invoice_payments(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists booking_prepayments_unapplied_idx
  on public.booking_prepayments (booking_id)
  where applied_at is null;
create index if not exists booking_prepayments_org_idx
  on public.booking_prepayments (organization_id, created_at desc);

alter table public.booking_prepayments enable row level security;
alter table public.booking_prepayments force row level security;

-- Money in is owner/admin business, same as invoice payments.
drop policy if exists "owners admins manage prepayments" on public.booking_prepayments;
create policy "owners admins manage prepayments"
  on public.booking_prepayments
  for all
  using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));
