-- Per-org service catalog.
--
-- Until now the only "services" Sollos supported were the 8 hardcoded
-- enum values (standard, deep, move_out, recurring, meeting,
-- consultation, walkthrough, other). Owners couldn't add "Window
-- cleaning", "Pool cleaning", "Office turnover", etc. without a code
-- change.
--
-- This migration introduces a `service_types` table per organization
-- where owners can curate the services they actually offer. Default
-- rows are seeded for every existing org so nothing changes from a
-- user's perspective on day one.
--
-- COMPATIBILITY STRATEGY
-- ----------------------
-- We KEEP the existing `bookings.service_type` and
-- `contracts.service_type` enum columns and continue populating them
-- on every write. Every service_type row carries a `category` that
-- maps to an enum value — custom services land in 'other' if they
-- don't match a built-in category. This means every read site that
-- consumes the enum (50+ files: GCal sync, reports, calendar
-- coloring, public client portal, cron jobs) keeps working unchanged.
--
-- We ADD two denormalized columns on bookings and contracts:
--   - service_type_id    — FK to the row in service_types
--   - service_type_label — display name copied from service_types.name
--                          at write time. Cheap reads, no join needed.
--
-- The display layer (booking detail, scheduler card, etc.) is updated
-- to prefer service_type_label when present; otherwise it falls back
-- to a label derived from the enum. Old rows (before this migration)
-- get their label backfilled below so the fallback rarely runs.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.service_types (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Bucket this custom service belongs to. Maps to the enum that the
  -- bookings.service_type column still uses so existing read sites
  -- keep working. Custom user-added services typically land in
  -- 'other'; the 'recurring' and 'standard' categories are special
  -- because the form / pricing flows have logic keyed off them.
  category                 public.service_type NOT NULL DEFAULT 'other',

  -- Display name shown everywhere. Unique per org so an owner can't
  -- accidentally have two "Deep clean" entries.
  name                     text NOT NULL,
  description              text,

  -- Owner-provided defaults that pre-fill the booking form when the
  -- service is selected. All nullable — owners are free to leave them
  -- blank and enter values per booking.
  default_duration_minutes integer CHECK (default_duration_minutes IS NULL OR default_duration_minutes > 0),
  default_price_cents      integer CHECK (default_price_cents IS NULL OR default_price_cents >= 0),

  -- Hex color (#RRGGBB) used by the scheduler to tint cards. NULL
  -- falls back to a category-based color in src/app/app/scheduling/color.ts.
  color                    text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),

  -- Lower sort_order shows first in the dropdown. Defaults to 100
  -- so user-added services land below the seeded defaults (0-79).
  sort_order               integer NOT NULL DEFAULT 100,

  is_active                boolean NOT NULL DEFAULT true,
  archived_at              timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES public.memberships(id) ON DELETE SET NULL,

  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS service_types_organization_id_idx
  ON public.service_types (organization_id);
CREATE INDEX IF NOT EXISTS service_types_active_idx
  ON public.service_types (organization_id, is_active)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS service_types_set_updated_at ON public.service_types;
CREATE TRIGGER service_types_set_updated_at
BEFORE UPDATE ON public.service_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;

-- Anyone in the org can READ active services (the booking form, client
-- portal request form, etc. all need this).
DROP POLICY IF EXISTS "members read service_types" ON public.service_types;
CREATE POLICY "members read service_types" ON public.service_types
  FOR SELECT
  USING (
    organization_id IN (
      SELECT m.organization_id FROM public.memberships m
      WHERE m.profile_id = auth.uid() AND m.status = 'active'
    )
  );

-- Only owners + admins can CREATE / UPDATE / DELETE.
DROP POLICY IF EXISTS "admins write service_types" ON public.service_types;
CREATE POLICY "admins write service_types" ON public.service_types
  FOR ALL
  USING (
    organization_id IN (
      SELECT m.organization_id FROM public.memberships m
      WHERE m.profile_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT m.organization_id FROM public.memberships m
      WHERE m.profile_id = auth.uid()
        AND m.status = 'active'
        AND m.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Seed defaults for every existing org
-- ---------------------------------------------------------------------------
--
-- These mirror the 8 built-in enum values + a few common cleaning-
-- industry add-ons. Owners can rename, archive, or extend any of
-- them from Settings → Services.
--
-- sort_order < 100 keeps the seeded ones above any custom additions.

INSERT INTO public.service_types
  (organization_id, category, name, description, default_duration_minutes, color, sort_order)
SELECT o.id, c.category, c.name, c.description, c.default_duration_minutes, c.color, c.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('standard'::public.service_type,     'Standard clean',         'Regular recurring clean — kitchen, bathrooms, floors, dust.', 120, NULL,        10),
  ('deep'::public.service_type,         'Deep clean',             'First-time or quarterly deep clean — baseboards, inside cabinets, full scrub.', 240, NULL,  20),
  ('move_out'::public.service_type,     'Move-out clean',         'End-of-tenancy turnover clean. Inside oven, fridge, cabinets.', 300, NULL,         30),
  ('recurring'::public.service_type,    'Recurring clean',        'Generic recurring service — used by the recurring-bookings flow.', 120, NULL,       40),
  ('walkthrough'::public.service_type,  'Walkthrough / quote',    'On-site quote visit. Usually unpaid.',                                30,  NULL,       50),
  ('consultation'::public.service_type, 'Initial consultation',   'First-meeting / scoping call. Usually unpaid.',                       30,  NULL,       60),
  ('meeting'::public.service_type,      'Meeting',                'Internal or client meeting.',                                         60,  NULL,       70),
  ('other'::public.service_type,        'Other',                  'Anything that doesn''t fit a category. Keep this as a fallback.',     60,  NULL,       80)
) AS c (category, name, description, default_duration_minutes, color, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Add FK + denormalized label columns to bookings and contracts
-- ---------------------------------------------------------------------------
--
-- `service_type_id` is nullable for now (legacy rows + bookings created
-- through APIs that don't know about the new column). The enum column
-- remains NOT NULL and is the authoritative thing for legacy reads.
--
-- ON DELETE SET NULL on the FK so an admin archiving a service doesn't
-- nuke the historical booking link.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_type_id    uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type_label text;

CREATE INDEX IF NOT EXISTS bookings_service_type_id_idx
  ON public.bookings (service_type_id);

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS service_type_id    uuid REFERENCES public.service_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_type_label text;

CREATE INDEX IF NOT EXISTS contracts_service_type_id_idx
  ON public.contracts (service_type_id);

-- ---------------------------------------------------------------------------
-- 5. Backfill existing bookings + contracts
-- ---------------------------------------------------------------------------
--
-- For every existing booking, find the org's seeded service_type row
-- whose category matches the booking's enum value, then copy its id
-- and name across. Bookings whose enum was 'other' fall through to
-- the 'Other' seed row; we never leave service_type_label blank for
-- legacy rows so the display layer's fallback path is rarely hit.

UPDATE public.bookings b
SET
  service_type_id    = st.id,
  service_type_label = st.name
FROM public.service_types st
WHERE b.service_type_id IS NULL
  AND st.organization_id = b.organization_id
  AND st.category        = b.service_type
  AND st.sort_order      < 100;  -- only the seeded rows; later customs are skipped

UPDATE public.contracts c
SET
  service_type_id    = st.id,
  service_type_label = st.name
FROM public.service_types st
WHERE c.service_type_id IS NULL
  AND st.organization_id = c.organization_id
  AND st.category        = c.service_type
  AND st.sort_order      < 100;
