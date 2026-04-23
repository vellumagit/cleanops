-- Pre- / post-job checklists
--
-- Owners build reusable templates ("Move-out deep clean," "Weekly office,"
-- "Post-job inspection"). When a template is attached to a booking, its
-- items are COPIED into booking_checklist_items so subsequent template
-- edits don't change the historical record of what was actually checked.
--
-- Items carry an optional `phase` (pre/during/post) for visual grouping;
-- the field app treats any unchecked item as pending work.

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  -- Optional: auto-apply to bookings of this service_type. NULL = manual only.
  applies_to_service_type text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_templates_org_idx
  ON public.checklist_templates (organization_id);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_checklist_templates"
  ON public.checklist_templates FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "org_managers_write_checklist_templates"
  ON public.checklist_templates FOR ALL
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

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.checklist_template_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid        NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ordinal         integer     NOT NULL DEFAULT 0,
  title           text        NOT NULL,
  phase           text        NOT NULL DEFAULT 'during' CHECK (phase IN ('pre', 'during', 'post')),
  is_required     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_template_items_template_idx
  ON public.checklist_template_items (template_id, ordinal);

ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_checklist_template_items"
  ON public.checklist_template_items FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "org_managers_write_checklist_template_items"
  ON public.checklist_template_items FOR ALL
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

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_checklist_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  booking_id      uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  -- Snapshot of where this came from; template can be edited/deleted freely.
  source_template_id uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  ordinal         integer     NOT NULL DEFAULT 0,
  title           text        NOT NULL,
  phase           text        NOT NULL DEFAULT 'during' CHECK (phase IN ('pre', 'during', 'post')),
  is_required     boolean     NOT NULL DEFAULT false,
  checked_at      timestamptz,
  checked_by      uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_checklist_items_booking_idx
  ON public.booking_checklist_items (booking_id, ordinal);

ALTER TABLE public.booking_checklist_items ENABLE ROW LEVEL SECURITY;

-- Any org member can read (crew need to see the list to work it).
CREATE POLICY "org_members_read_booking_checklist_items"
  ON public.booking_checklist_items FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

-- Writes: owner/admin/manager for admin-side attach/edit, plus the
-- assigned cleaner(s) can toggle checked state on their own jobs via
-- the field app. We keep the policy permissive at the DB layer (any
-- active org member can update) because the field app only shows the
-- check button to assignees and sets checked_by to themselves — the
-- app is the authoritative gate.
CREATE POLICY "org_members_write_booking_checklist_items"
  ON public.booking_checklist_items FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ))
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

COMMENT ON TABLE public.checklist_templates IS
  'Reusable checklist templates (e.g. "Move-out clean", "Weekly office"). Items live in checklist_template_items; when attached to a booking, items are copied into booking_checklist_items so historical records are immutable.';
