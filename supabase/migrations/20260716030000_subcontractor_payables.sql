-- Subcontractor payables: what the business owes subcontractors for completed
-- shifts (derived from claimed job_offers on completed bookings), the payments
-- made to them, and the invoices they send us.

-- ── Payouts: money paid TO a subcontractor ──────────────────────────────────
create table if not exists public.subcontractor_payouts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid not null references public.freelancer_contacts(id) on delete cascade,
  amount_cents    integer not null check (amount_cents > 0),
  paid_on         date not null default current_date,
  method          text,        -- e.g. "e-transfer", "cash", "cheque"
  reference       text,
  notes           text,
  recorded_by     uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists subcontractor_payouts_contact_idx on public.subcontractor_payouts (contact_id);
create index if not exists subcontractor_payouts_org_idx on public.subcontractor_payouts (organization_id);

-- ── Bills: invoices the subcontractor sent US (uploaded files) ──────────────
create table if not exists public.subcontractor_bills (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id      uuid not null references public.freelancer_contacts(id) on delete cascade,
  amount_cents    integer check (amount_cents is null or amount_cents >= 0),
  bill_date       date,
  label           text not null,
  file_name       text not null,
  file_path       text not null,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists subcontractor_bills_contact_idx on public.subcontractor_bills (contact_id);
create index if not exists subcontractor_bills_org_idx on public.subcontractor_bills (organization_id);

alter table public.subcontractor_payouts enable row level security;
alter table public.subcontractor_bills enable row level security;

-- Owner/admin/manager may read; all writes go through service-role server
-- actions that enforce the same check — so no INSERT/UPDATE/DELETE policy.
drop policy if exists subcontractor_payouts_select on public.subcontractor_payouts;
create policy subcontractor_payouts_select on public.subcontractor_payouts
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = subcontractor_payouts.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin','manager')
      and m.status = 'active'
  ));

drop policy if exists subcontractor_bills_select on public.subcontractor_bills;
create policy subcontractor_bills_select on public.subcontractor_bills
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.organization_id = subcontractor_bills.organization_id
      and m.profile_id = auth.uid()
      and m.role in ('owner','admin','manager')
      and m.status = 'active'
  ));

-- Private storage bucket for the uploaded bill files (access via service role).
insert into storage.buckets (id, name, public)
values ('subcontractor-bills', 'subcontractor-bills', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
