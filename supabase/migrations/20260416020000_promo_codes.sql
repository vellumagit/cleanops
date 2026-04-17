-- =============================================================================
-- Promo codes + redemptions
-- =============================================================================
-- These tables were originally created via the old project's SQL editor
-- and never committed as a migration. Backfilled during the Supabase restore
-- so the RedeemForm on Settings → Billing works end-to-end.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  kind               text NOT NULL CHECK (kind IN ('free_forever','comp')),
  active             boolean NOT NULL DEFAULT true,
  expires_at         timestamptz,
  max_redemptions    integer NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemption_count   integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES public.memberships(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON public.promo_codes (code);
CREATE INDEX IF NOT EXISTS promo_codes_active_idx ON public.promo_codes (active) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id     uuid NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  redeemed_by       uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  redeemed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, organization_id)
);

CREATE INDEX IF NOT EXISTS promo_redemptions_org_idx ON public.promo_redemptions (organization_id);

-- Service-role only — redemption is always via the server-side admin client
ALTER TABLE public.promo_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_redemptions  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.promo_codes IS 'Redeemable codes that flip organizations.billing_override to free_forever or comp.';
