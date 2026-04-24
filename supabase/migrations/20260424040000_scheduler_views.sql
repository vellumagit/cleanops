-- =============================================================================
-- Per-org saved scheduler views
-- =============================================================================
-- Owners frequently want preset filter combinations — e.g. "Weekend
-- crew only", "Team A", "Just residential jobs". Rather than make every
-- user configure their own localStorage filters from scratch, saved
-- views let the owner curate a small menu of useful lenses that every
-- user in the org sees in the scheduler.
--
-- Per-org (not per-user) matches the user's product decision earlier —
-- "everyone sees the same curated list the owner set up." Per-user
-- ad-hoc filtering still exists via the localStorage state in the
-- filter popover; saved views are the shared layer on top.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scheduler_views (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  -- JSON payload matching the SchedulerFilters shape used by the
  -- scheduler-filters component. Stored as jsonb so we can evolve
  -- the shape without migrations.
  filters         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sort_order      int         NOT NULL DEFAULT 0,
  created_by      uuid        REFERENCES public.memberships(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS scheduler_views_org_idx
  ON public.scheduler_views (organization_id, sort_order);

DROP TRIGGER IF EXISTS scheduler_views_set_updated_at ON public.scheduler_views;
CREATE TRIGGER scheduler_views_set_updated_at
BEFORE UPDATE ON public.scheduler_views
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.scheduler_views ENABLE ROW LEVEL SECURITY;

-- Read: any active member of the org (everyone benefits from the
-- owner's curated views).
DROP POLICY IF EXISTS "org_members_read_scheduler_views" ON public.scheduler_views;
CREATE POLICY "org_members_read_scheduler_views"
  ON public.scheduler_views FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));

-- Write: owners/admins/managers only. Views are a curation act — we
-- don't want every cleaner to be able to add their own to the shared
-- menu.
DROP POLICY IF EXISTS "managers_write_scheduler_views" ON public.scheduler_views;
CREATE POLICY "managers_write_scheduler_views"
  ON public.scheduler_views FOR ALL
  TO authenticated
  USING (
    public.current_user_has_role(
      organization_id,
      ARRAY['owner','admin','manager']::public.membership_role[]
    )
  )
  WITH CHECK (
    public.current_user_has_role(
      organization_id,
      ARRAY['owner','admin','manager']::public.membership_role[]
    )
  );

COMMENT ON TABLE public.scheduler_views IS
  'Saved scheduler filter presets shared across the org. Everyone reads; owners/admins/managers write.';
