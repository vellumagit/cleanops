-- Multi-crew assignment on a single booking
--
-- The bookings.assigned_to column (a single membership FK) has always been
-- the "primary assignee." For deep cleans, move-outs, or any two-person
-- job, owners asked for a way to schedule multiple cleaners on one
-- booking. This migration adds a junction table and keeps assigned_to as
-- the authoritative "primary" pointer for backward compat.
--
-- Migration behavior:
--   - Create booking_assignees with (booking_id, membership_id, is_primary)
--   - Backfill: every booking with assigned_to gets a row marked primary.
--   - Going forward, the app writes ALL assignees to this table, and
--     keeps bookings.assigned_to synced with the primary row.

CREATE TABLE IF NOT EXISTS public.booking_assignees (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  booking_id      uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  membership_id   uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  is_primary      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, membership_id)
);

CREATE INDEX IF NOT EXISTS booking_assignees_booking_idx
  ON public.booking_assignees (booking_id);
CREATE INDEX IF NOT EXISTS booking_assignees_membership_idx
  ON public.booking_assignees (membership_id);

-- At most one primary assignee per booking. Enforced via partial unique
-- index so a booking with zero assignees (unassigned) is still valid.
CREATE UNIQUE INDEX IF NOT EXISTS booking_assignees_one_primary_idx
  ON public.booking_assignees (booking_id)
  WHERE is_primary = true;

-- Backfill: for every booking currently assigned, create a primary row.
INSERT INTO public.booking_assignees (organization_id, booking_id, membership_id, is_primary)
SELECT b.organization_id, b.id, b.assigned_to, true
FROM public.bookings b
WHERE b.assigned_to IS NOT NULL
ON CONFLICT (booking_id, membership_id) DO NOTHING;

-- RLS: same org-scoping as bookings.
ALTER TABLE public.booking_assignees ENABLE ROW LEVEL SECURITY;

-- Any active org member can read assignees (mirrors bookings SELECT policy).
CREATE POLICY "org_members_read_booking_assignees"
  ON public.booking_assignees FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

-- Owner/admin/manager can write (mirrors booking mutation policy).
CREATE POLICY "org_managers_write_booking_assignees"
  ON public.booking_assignees FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ));

COMMENT ON TABLE public.booking_assignees IS
  'Every person assigned to a booking. Primary assignee is also mirrored in bookings.assigned_to for backward compat with single-assignee code paths.';
