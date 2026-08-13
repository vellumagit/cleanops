-- =============================================================================
-- Which pay system a shift belongs to — decided when it is worked, not read
-- supabase/migrations/20260813010000_time_entries_engagement_snapshot.sql
-- =============================================================================
-- Payroll and Subcontractor pay both partition a person's hours by
-- memberships.engagement AT READ TIME. That is the double-pay trap the
-- 2026-08-12 audit named its top finding: pay a subcontractor's balance,
-- flip them to employee, run payroll over the same weeks — the identical
-- unstamped hours are paid a second time through the other system, because
-- nothing on the entry says which system it was worked under. The reverse
-- flip presents employment-era hours as subcontractor payables: pay through
-- the wrong system, with the wrong tax paper.
--
-- Same cure as pay_rate_cents_snapshot (20260601030000), same reasoning:
-- history must not re-price — or here, re-ROUTE — when the present changes.
-- Every entry now records the worker's engagement at clock-in. Payroll pays
-- employee-era entries; Subcontractor pay counts subcontractor-era entries;
-- flipping someone's engagement changes only the shifts they haven't worked
-- yet.
--
-- NULLABLE, backfilled, then written by the app on every insert. A NULL
-- (only possible if some future writer forgets) means "resolve by the
-- owner's current engagement" — exactly the old behavior, so a missed
-- writer degrades to the status quo instead of losing hours.
--
-- The backfill uses each member's CURRENT engagement, which is what both
-- pay screens already assume about every historical row — so nothing an
-- owner sees changes at migration time.

alter table public.time_entries
  add column if not exists engagement_snapshot text
    check (engagement_snapshot in ('employee', 'subcontractor'));

update public.time_entries te
set engagement_snapshot = coalesce(m.engagement, 'employee')
from public.memberships m
where m.id = te.employee_id
  and te.engagement_snapshot is null;

-- The payables hot path: unstamped subcontractor-era hours for an org.
create index if not exists time_entries_org_engagement_unstamped_idx
  on public.time_entries (organization_id, engagement_snapshot)
  where payroll_run_id is null;

comment on column public.time_entries.engagement_snapshot is
  'The worker''s memberships.engagement when this shift was clocked. Payroll pays employee rows; Subcontractor pay counts subcontractor rows — so flipping a person''s engagement re-routes only future shifts, never recorded ones. NULL (legacy/missed writer) falls back to the owner''s current engagement.';

notify pgrst, 'reload schema';
