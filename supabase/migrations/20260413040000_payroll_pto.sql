-- Pay model + PTO tracking for the payroll module.

-- ── Pay type on memberships ────────────────────────────────────
-- hourly  = pay_rate_cents × hours worked
-- flat    = pay_rate_cents per completed job (regardless of time)
-- percent = pay_rate_cents is a percentage (e.g. 4000 = 40%) of booking.total_cents

alter table public.memberships
  add column if not exists pay_type text not null default 'hourly'
    check (pay_type in ('hourly', 'flat', 'percent'));

-- ── PTO / time-off tracking ───────────────────────────────────

create table if not exists public.pto_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.memberships(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  hours           numeric(6,2) not null default 8.00,
  reason          text,
  status          text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  reviewed_by     uuid references public.memberships(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists pto_requests_org_idx
  on public.pto_requests (organization_id);
create index if not exists pto_requests_employee_idx
  on public.pto_requests (employee_id);
create index if not exists pto_requests_dates_idx
  on public.pto_requests (organization_id, start_date, end_date);

alter table public.pto_requests enable row level security;

create policy "members can view own org pto requests"
  on public.pto_requests for select
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid() and m.status = 'active'
    )
  );

create policy "employees can insert own pto requests"
  on public.pto_requests for insert
  with check (
    employee_id in (
      select m.id from public.memberships m
      where m.profile_id = auth.uid() and m.status = 'active'
    )
  );

create policy "admins can manage pto requests"
  on public.pto_requests for all
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'manager')
    )
  );

-- ── PTO balances (annual allocation per employee) ─────────────

create table if not exists public.pto_balances (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id     uuid not null references public.memberships(id) on delete cascade,
  year            integer not null default extract(year from now()),
  allocated_hours numeric(6,2) not null default 0,
  used_hours      numeric(6,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, year)
);

create index if not exists pto_balances_org_idx
  on public.pto_balances (organization_id);
create index if not exists pto_balances_employee_year_idx
  on public.pto_balances (employee_id, year);

alter table public.pto_balances enable row level security;

create policy "members can view own org pto balances"
  on public.pto_balances for select
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid() and m.status = 'active'
    )
  );

create policy "admins can manage pto balances"
  on public.pto_balances for all
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin', 'manager')
    )
  );
