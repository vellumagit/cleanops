-- -----------------------------------------------------------------------------
-- API Keys table
--
-- Stores hashed API keys for the v1 REST API. Keys are SHA-256 hashed
-- before storage; only the prefix (first 8 chars) is stored in plaintext
-- for identification in the UI.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_hash         text NOT NULL UNIQUE,
  key_prefix       text NOT NULL,
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  created_by       uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (organization_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON public.api_keys (key_hash);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;

-- API key operations go through the admin client (service role),
-- so no user-facing RLS policies are needed. The admin client
-- bypasses RLS entirely.

COMMENT ON TABLE public.api_keys IS 'Hashed API keys for the v1 REST API. Only the prefix is stored in cleartext.';
