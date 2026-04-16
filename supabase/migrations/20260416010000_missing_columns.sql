-- =============================================================================
-- Backfill columns that were added manually in the old project's SQL editor
-- and never committed as migrations. Caught during the Supabase restore.
-- =============================================================================

-- organizations: billing override (used by /app/settings/billing)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_override text
    CHECK (billing_override IS NULL OR billing_override IN ('free_forever','comp')),
  ADD COLUMN IF NOT EXISTS billing_override_at   timestamptz,
  ADD COLUMN IF NOT EXISTS billing_override_note text;

COMMENT ON COLUMN public.organizations.billing_override IS
  'Non-billing override for owner-comped orgs. NULL = normal Stripe billing.';

-- api_keys: updated_at (from set_updated_at trigger pattern)
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS api_keys_set_updated_at ON public.api_keys;
CREATE TRIGGER api_keys_set_updated_at
BEFORE UPDATE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
