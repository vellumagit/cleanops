-- Add address + internal notes columns to memberships so admins can
-- maintain a complete employee profile (home address, admin-only memos).

ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS address text
    CHECK (address IS NULL OR length(address) <= 300),
  ADD COLUMN IF NOT EXISTS notes   text
    CHECK (notes IS NULL OR length(notes)   <= 2000);

COMMENT ON COLUMN public.memberships.address IS
  'Home / mailing address for this employee. Admin-visible only.';
COMMENT ON COLUMN public.memberships.notes IS
  'Internal admin notes about this employee. Not visible to the employee.';
