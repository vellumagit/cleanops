-- Move `notes` and `address` off the `memberships` table into a new
-- admin-only table so the blanket "members can read memberships in their org"
-- SELECT policy doesn't expose internal HR data to employees.
--
-- Only active owners and admins of the same org can SELECT / INSERT / UPDATE /
-- DELETE rows in this table. Service-role (admin client) bypasses RLS as usual.

CREATE TABLE IF NOT EXISTS public.membership_admin_data (
  membership_id   uuid        PRIMARY KEY
                              REFERENCES public.memberships(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL
                              REFERENCES public.organizations(id) ON DELETE CASCADE,
  notes           text        CHECK (char_length(notes) <= 2000),
  address         text        CHECK (char_length(address) <= 300),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.membership_admin_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owners and admins manage membership admin data"
  ON public.membership_admin_data
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   public.memberships m
      WHERE  m.profile_id      = auth.uid()
        AND  m.organization_id = membership_admin_data.organization_id
        AND  m.role            IN ('owner', 'admin')
        AND  m.status          = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.memberships m
      WHERE  m.profile_id      = auth.uid()
        AND  m.organization_id = membership_admin_data.organization_id
        AND  m.role            IN ('owner', 'admin')
        AND  m.status          = 'active'
    )
  );

-- Migrate existing data before dropping the columns.
INSERT INTO public.membership_admin_data (membership_id, organization_id, notes, address)
SELECT id, organization_id, notes, address
FROM   public.memberships
WHERE  notes IS NOT NULL OR address IS NOT NULL
ON CONFLICT (membership_id) DO NOTHING;

-- Drop the old columns from memberships.
ALTER TABLE public.memberships
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS address;
