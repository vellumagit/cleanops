-- =============================================================================
-- Contracts: built-in e-signing (Phase 16)
-- =============================================================================
-- Rather than integrate DocuSign / HelloSign (extra vendor, $15-40/mo min,
-- API credentials per user, webhook complexity), Sollos gets its own
-- e-sign flow that matches what small cleaning companies actually need:
--   - Owner creates a contract in /app/contracts
--   - Clicks "Send for signature" → we mint a public token
--   - Owner copies the sign link (/c/<token>) to the client
--   - Client reads the contract terms + types their full name + clicks
--     "I agree and sign" on the public page
--   - We record signed_at, signer_name, signer_ip, user_agent
--
-- This is legally binding under the US ESIGN Act and UETA (and their
-- equivalents in Canada / UK / EU) — the standard is "intent to sign"
-- plus a record of the action. Courts have upheld clickwrap +
-- typed-name agreements for cleaning contracts routinely.
--
-- Drawn-signature canvas is a v2 enhancement; typed name + click is
-- enough for v1.
-- =============================================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS public_token    text,
  ADD COLUMN IF NOT EXISTS sign_status     text NOT NULL DEFAULT 'unsent',
  ADD COLUMN IF NOT EXISTS sent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS signed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS signer_name     text,
  ADD COLUMN IF NOT EXISTS signer_ip       inet,
  ADD COLUMN IF NOT EXISTS signer_user_agent text;

-- Lifecycle: unsent → sent → signed. 'declined' reserved for future use
-- (client rejects the contract from the public page).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_sign_status_check'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_sign_status_check
      CHECK (sign_status IN ('unsent', 'sent', 'signed', 'declined'));
  END IF;
END $$;

-- Public token: 16-char url-safe cap token. Globally unique so the
-- /c/<token> route can find it without needing the contract id.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_public_token_uidx
  ON public.contracts (public_token)
  WHERE public_token IS NOT NULL;

COMMENT ON COLUMN public.contracts.public_token IS
  '16-char cap token for the public sign page at /c/<token>. NULL until the owner hits "Send for signature".';
COMMENT ON COLUMN public.contracts.sign_status IS
  'unsent | sent | signed | declined. Orthogonal to status (active/ended/cancelled) — a contract can be sent but still "active" pending signature.';
COMMENT ON COLUMN public.contracts.signer_ip IS
  'IP address the signer used. Required evidence for ESIGN / UETA compliance.';

-- ----------------------------------------------------------------------------
-- Public access policy — the signer auths via the token, not auth.uid().
-- Reads use the admin client in the /c/<token> route, so no public
-- SELECT policy needed. Org members can already read contracts via
-- the existing org-scoped policies set up in domain_rls.
-- ----------------------------------------------------------------------------
