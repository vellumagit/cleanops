-- =============================================================================
-- Migration: Recurring bookings
-- Adds a booking_series table that stores recurrence rules, and links
-- individual booking rows back to their series via series_id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: booking_series
-- Stores the recurrence rule. Individual bookings reference this via series_id.
-- -----------------------------------------------------------------------------

create table if not exists public.booking_series (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete restrict,

  -- Recurrence rule
  -- pattern: 'weekly' | 'bi_weekly' | 'tri_weekly' | 'monthly' | 'custom_weekly'
  pattern             text not null check (pattern in ('weekly', 'bi_weekly', 'tri_weekly', 'monthly', 'custom_weekly')),

  -- For custom_weekly: which days of the week (0=Sun, 1=Mon, …, 6=Sat)
  -- Stored as a sorted integer array, e.g. [1, 4] = Monday + Thursday
  -- NULL for non-custom patterns (they use the first booking's weekday)
  custom_days         smallint[] check (
    custom_days is null
    or (array_length(custom_days, 1) > 0 and array_length(custom_days, 1) <= 7)
  ),

  -- The time of day for each occurrence (HH:MM in 24h). For custom_weekly
  -- with multiple days, all occurrences use this same time.
  start_time          time not null,

  -- How many instances to generate ahead (rolling window)
  -- Default 8 = roughly 2 months of weekly cleans
  generate_ahead      integer not null default 8 check (generate_ahead > 0 and generate_ahead <= 52),

  -- Bookings inherit these defaults from the series
  duration_minutes    integer not null check (duration_minutes > 0),
  service_type        text not null default 'recurring',
  package_id          uuid references public.packages(id) on delete set null,
  assigned_to         uuid references public.memberships(id) on delete set null,
  total_cents         integer not null default 0 check (total_cents >= 0),
  hourly_rate_cents   integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  address             text,
  notes               text,

  -- Series lifecycle
  -- starts_at: the date the recurrence begins (first occurrence)
  starts_at           date not null,
  -- ends_at: optional — if NULL the series continues indefinitely (until paused/cancelled)
  ends_at             date,
  -- active: false = paused (no new instances generated)
  active              boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists booking_series_org_idx on public.booking_series (organization_id);
create index if not exists booking_series_client_idx on public.booking_series (client_id);
create index if not exists booking_series_active_idx on public.booking_series (organization_id, active) where active = true;

drop trigger if exists booking_series_set_updated_at on public.booking_series;
create trigger booking_series_set_updated_at
before update on public.booking_series
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Add series_id to bookings
-- Links individual occurrences back to the series they belong to.
-- NULL for standalone (non-recurring) bookings.
-- -----------------------------------------------------------------------------

alter table public.bookings
  add column if not exists series_id uuid references public.booking_series(id) on delete set null;

create index if not exists bookings_series_id_idx on public.bookings (series_id) where series_id is not null;

-- -----------------------------------------------------------------------------
-- RLS policies for booking_series
-- Same pattern as other domain tables: members can read, admins+ can write.
-- -----------------------------------------------------------------------------

alter table public.booking_series enable row level security;

create policy "members can read own org series"
on public.booking_series for select
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

create policy "admins can manage own org series"
on public.booking_series for all
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'manager')
  )
)
with check (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'manager')
  )
);
