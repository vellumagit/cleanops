-- Employee availability — recurring weekly slots + one-off date overrides.
--
-- Scheduling a 3-5 person crew across a week is guess-and-check without
-- knowing who's available when. This migration adds two tables:
--
--   availability_slots: "I work Mon-Fri, 8am to 4pm" — the recurring
--     default that applies every week. Multiple rows per day supports
--     split shifts (e.g. 8-12 and 2-6).
--
--   availability_overrides: exceptions for a specific date. kind='off'
--     means "I'm not available that day"; kind='custom' means "I'm
--     available only during these hours that day, ignoring the weekly
--     slot."
--
-- Reading availability = slots for that day-of-week, overridden by any
-- override row on that specific date. Easy to reason about, no crazy
-- recurrence rules.

-- -----------------------------------------------------------------------------
-- RECURRING WEEKLY SLOTS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.availability_slots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id   uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  day_of_week     smallint    NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  -- "HH:MM" strings keep the timezone question out of the DB — the app
  -- interprets these relative to the org's configured timezone.
  start_time      text        NOT NULL CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time        text        NOT NULL CHECK (end_time   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS availability_slots_member_idx
  ON public.availability_slots (membership_id, day_of_week);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

-- Read: any active org member can read any member's availability (the
-- scheduler needs it, and the crew benefits from seeing each other's).
CREATE POLICY "org_members_read_availability_slots"
  ON public.availability_slots FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

-- Write: the member themselves, or owner/admin/manager on their behalf.
CREATE POLICY "self_or_manager_write_availability_slots"
  ON public.availability_slots FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
    AND (
      membership_id IN (
        SELECT id FROM public.memberships WHERE profile_id = auth.uid()
      )
      OR organization_id IN (
        SELECT organization_id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
    AND (
      membership_id IN (
        SELECT id FROM public.memberships WHERE profile_id = auth.uid()
      )
      OR organization_id IN (
        SELECT organization_id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- ONE-OFF DATE OVERRIDES
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.availability_overrides (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id   uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('off', 'custom')),
  -- Only used when kind='custom'. Hours the member IS available that day,
  -- replacing (not adding to) the weekly slot.
  start_time      text        CHECK (start_time IS NULL OR start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time        text        CHECK (end_time   IS NULL OR end_time   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, date)
);

CREATE INDEX IF NOT EXISTS availability_overrides_member_date_idx
  ON public.availability_overrides (membership_id, date);

ALTER TABLE public.availability_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_availability_overrides"
  ON public.availability_overrides FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "self_or_manager_write_availability_overrides"
  ON public.availability_overrides FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
    AND (
      membership_id IN (
        SELECT id FROM public.memberships WHERE profile_id = auth.uid()
      )
      OR organization_id IN (
        SELECT organization_id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
    AND (
      membership_id IN (
        SELECT id FROM public.memberships WHERE profile_id = auth.uid()
      )
      OR organization_id IN (
        SELECT organization_id FROM public.memberships
        WHERE profile_id = auth.uid() AND status = 'active'
          AND role IN ('owner', 'admin', 'manager')
      )
    )
  );

COMMENT ON TABLE public.availability_slots IS
  'Recurring weekly availability per employee. One row per day-of-week + time window; multiple rows per day support split shifts.';
COMMENT ON TABLE public.availability_overrides IS
  'Date-specific availability changes: "off" removes that day, "custom" replaces the weekly slot with different hours.';
