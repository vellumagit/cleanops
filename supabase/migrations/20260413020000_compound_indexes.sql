-- Compound indexes for hot query paths at scale.
-- These cover the most common filtering patterns used by list pages,
-- bonus computations, scheduling conflict checks, and sidebar badge counts.

-- ── Bookings ──
-- Sidebar badge: "today's bookings" filters on (org, scheduled_at)
-- Scheduling: conflict check filters on (assigned_to, scheduled_at)
create index if not exists bookings_org_scheduled_idx
  on public.bookings (organization_id, scheduled_at);

create index if not exists bookings_org_status_idx
  on public.bookings (organization_id, status);

create index if not exists bookings_assignee_scheduled_idx
  on public.bookings (assigned_to, scheduled_at)
  where assigned_to is not null;

-- ── Invoices ──
-- Sidebar badge: overdue invoices filtered by (org, status)
-- List page commonly filters by status
create index if not exists invoices_org_status_idx
  on public.invoices (organization_id, status);

-- ── Reviews ──
-- Bonus computation aggregates by (org, submitted_at)
create index if not exists reviews_org_submitted_idx
  on public.reviews (organization_id, submitted_at);

-- ── Time entries ──
-- Efficiency bonus: lookup by booking_id within an org
create index if not exists time_entries_org_employee_idx
  on public.time_entries (organization_id, employee_id);

-- ── Bonuses ──
-- Duplicate check: (org, period_start, period_end, bonus_type)
create index if not exists bonuses_org_period_idx
  on public.bonuses (organization_id, period_start, period_end);

-- ── Estimates ──
-- Sidebar badge: pending estimates filtered by (org, status)
create index if not exists estimates_org_status_idx
  on public.estimates (organization_id, status);

-- ── Memberships ──
-- RLS subquery: every single policy checks (profile_id, status)
create index if not exists memberships_profile_status_idx
  on public.memberships (profile_id, status);

-- ── Unique constraints to prevent race conditions ──
-- Only one auto-generated invoice per booking
create unique index if not exists invoices_booking_uidx
  on public.invoices (booking_id)
  where booking_id is not null;

-- Only one booking auto-created from an estimate
create unique index if not exists bookings_estimate_uidx
  on public.bookings (estimate_id)
  where estimate_id is not null;
