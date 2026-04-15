-- =============================================================================
-- Per-org currency setting
-- =============================================================================
-- Until now the app formatted all amounts as USD. Default new orgs to CAD
-- (our first paying customer is Canadian). Existing rows also default to CAD
-- — if an org was already using the app for USD billing, update it manually
-- after running this migration (see commented UPDATE at the bottom).
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'CAD'
    CHECK (currency_code IN ('CAD','USD'));

COMMENT ON COLUMN public.organizations.currency_code IS
  'Display currency for this org (CAD or USD). Stripe Connect currency is tied to the connected account, not this field.';

-- If a specific existing org should stay USD, run something like:
--   UPDATE public.organizations SET currency_code = 'USD' WHERE slug = 'my-us-org';
