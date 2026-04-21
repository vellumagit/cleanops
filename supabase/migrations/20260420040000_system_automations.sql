-- System-level hygiene automations: 5 features, one migration.
--
-- 1. Auto-expire stale estimates: adds 'expired' to estimate_status enum.
-- 2. Auto-void old overdue invoices: no schema change (enum already has 'void').
-- 3. Auto-complete past bookings: no schema change (booking_status has 'completed').
-- 4. Auto-archive old data: bookings/invoices/estimates get archived_at column.
-- 5. Auto-recurring invoices: new invoice_series table + org config column.
--
-- Per-org tuning lives on organizations (nullable → use hard-coded defaults
-- in the cron).
--
-- Idempotent — safe to re-run.

-- ── 1. Estimate 'expired' status ──────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum
     where enumlabel = 'expired'
       and enumtypid = 'public.estimate_status'::regtype
  ) then
    alter type public.estimate_status add value 'expired';
  end if;
end $$;

-- ── 2. Per-org tuning for the hygiene crons ───────────────────────
alter table public.organizations
  add column if not exists stale_estimate_expire_days   integer default 30 check (stale_estimate_expire_days is null or stale_estimate_expire_days >= 1),
  add column if not exists invoice_void_days            integer default 90 check (invoice_void_days is null or invoice_void_days >= 30),
  add column if not exists booking_auto_complete_hours  integer default 24 check (booking_auto_complete_hours is null or booking_auto_complete_hours >= 1),
  add column if not exists archive_after_days           integer default 730 check (archive_after_days is null or archive_after_days >= 180);

comment on column public.organizations.stale_estimate_expire_days is
  'An estimate in status=sent with no activity for this many days is auto-flipped to expired. Default 30. NULL disables the cron for this org.';
comment on column public.organizations.invoice_void_days is
  'An invoice overdue for more than this many days with no payment activity is auto-flipped to void. Default 90. NULL disables the cron for this org.';
comment on column public.organizations.booking_auto_complete_hours is
  'A booking still in pending/confirmed this many hours past scheduled_at is auto-flipped to completed. Default 24. NULL disables the cron for this org.';
comment on column public.organizations.archive_after_days is
  'Bookings/invoices/estimates older than this many days are auto-archived (archived_at set) and filtered from default list views. Default 730 (2 years). NULL disables archiving for this org.';

-- ── 3. Archive columns + default-list indexes ────────────────────
alter table public.bookings   add column if not exists archived_at timestamptz;
alter table public.invoices   add column if not exists archived_at timestamptz;
alter table public.estimates  add column if not exists archived_at timestamptz;

comment on column public.bookings.archived_at is
  'Set by the nightly archive cron once the booking is older than organizations.archive_after_days. Filtered from the default /app/bookings list.';
comment on column public.invoices.archived_at is
  'Set by the nightly archive cron once the invoice is older than organizations.archive_after_days. Filtered from the default /app/invoices list.';
comment on column public.estimates.archived_at is
  'Set by the nightly archive cron once the estimate is older than organizations.archive_after_days.';

-- Default-list indexes: most list queries care about "not archived" rows.
create index if not exists bookings_active_idx
  on public.bookings (organization_id, scheduled_at desc)
  where archived_at is null;
create index if not exists invoices_active_idx
  on public.invoices (organization_id, created_at desc)
  where archived_at is null;
create index if not exists estimates_active_idx
  on public.estimates (organization_id, created_at desc)
  where archived_at is null;

-- ── 4. Invoice series (recurring invoice schedule) ───────────────
create table if not exists public.invoice_series (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  client_id            uuid not null references public.clients(id) on delete restrict,
  name                 text not null check (length(name) between 1 and 200),
  cadence              text not null check (cadence in ('weekly','biweekly','monthly','quarterly')),
  amount_cents         integer not null check (amount_cents >= 0),
  line_items           jsonb not null default '[]'::jsonb,
  notes                text,
  active               boolean not null default true,
  next_run_at          timestamptz not null,
  last_generated_at    timestamptz,
  last_invoice_id      uuid references public.invoices(id) on delete set null,
  due_days             integer not null default 14 check (due_days >= 0),
  created_by           uuid references public.memberships(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.invoice_series is
  'Recurring invoice schedule. The daily cron /api/cron/recurring-invoices scans for rows where active=true and next_run_at <= now, generates a new invoice using amount_cents + line_items, then advances next_run_at by the cadence.';

create index if not exists invoice_series_organization_id_idx
  on public.invoice_series (organization_id);
create index if not exists invoice_series_client_id_idx
  on public.invoice_series (client_id);
create index if not exists invoice_series_due_idx
  on public.invoice_series (next_run_at)
  where active = true;

drop trigger if exists invoice_series_set_updated_at on public.invoice_series;
create trigger invoice_series_set_updated_at
before update on public.invoice_series
for each row execute function public.set_updated_at();

-- RLS: same pattern as the rest of the domain tables.
alter table public.invoice_series enable row level security;

drop policy if exists "members read own org invoice_series" on public.invoice_series;
create policy "members read own org invoice_series"
on public.invoice_series for select
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins write own org invoice_series" on public.invoice_series;
create policy "admins write own org invoice_series"
on public.invoice_series for all
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner','admin','manager')
  )
)
with check (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner','admin','manager')
  )
);
