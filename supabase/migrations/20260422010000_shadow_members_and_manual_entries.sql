-- Shadow employees + manual time entries
--
-- Two related capabilities to unblock owner-operators:
--
--   1. Shadow memberships — add someone as an employee without sending an
--      invite. Useful for family members, subs, or any crew who does the
--      work but never needs the app. These rows have NULL profile_id, so
--      they can never log in. A display_name + optional contact fields
--      cover the places the app currently reads profiles.full_name.
--
--   2. Manual time entries — owners/admins/managers can retroactively
--      log hours against any employee (including themselves). Powers
--      month-end catch-up and corrections for forgotten clock-outs.

-- -----------------------------------------------------------------------------
-- MEMBERSHIPS: make profile_id nullable + add shadow identity fields
-- -----------------------------------------------------------------------------

ALTER TABLE public.memberships
  ALTER COLUMN profile_id DROP NOT NULL;

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS display_name   text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

-- Every membership must have some identity source. Either it links to a
-- profile (regular invited member) or it carries a display_name (shadow).
ALTER TABLE public.memberships
  DROP CONSTRAINT IF EXISTS memberships_has_identity;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_has_identity
  CHECK (profile_id IS NOT NULL OR display_name IS NOT NULL);

-- Postgres treats NULLs as distinct in UNIQUE constraints, so the existing
-- (organization_id, profile_id) uniqueness still permits many shadow rows
-- per org. The constraint stays as-is.

COMMENT ON COLUMN public.memberships.display_name IS
  'For shadow memberships (no profile link). Falls back to this when profiles.full_name is not available.';
COMMENT ON COLUMN public.memberships.contact_email IS
  'Phone/email for shadow memberships. Not used for auth — purely for owner reference and future invoicing.';

-- -----------------------------------------------------------------------------
-- TIME_ENTRIES: track manual vs live-clocked entries + who entered them
-- -----------------------------------------------------------------------------

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS created_manually boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES public.memberships(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.time_entries.created_manually IS
  'true when the row came from a Log-hours form, false when from live clock-in/out. Used to render a "manual" badge on timesheets.';
COMMENT ON COLUMN public.time_entries.created_by IS
  'The owner/admin/manager who entered the row manually. NULL for live clock-in rows (the employee themselves is the author).';

-- -----------------------------------------------------------------------------
-- RLS: allow owner/admin/manager to INSERT/UPDATE/DELETE time entries for
-- any employee in their org. The field app already allows an employee to
-- insert their own rows via clock-in/out; we're adding the manager-writes
-- path here.
-- -----------------------------------------------------------------------------

-- Drop any pre-existing managerial write policies so re-running this
-- migration is idempotent.
DROP POLICY IF EXISTS "managers_insert_time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "managers_update_time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "managers_delete_time_entries" ON public.time_entries;

CREATE POLICY "managers_insert_time_entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ));

CREATE POLICY "managers_update_time_entries"
  ON public.time_entries FOR UPDATE
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

CREATE POLICY "managers_delete_time_entries"
  ON public.time_entries FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin', 'manager')
  ));
