-- =============================================================================
-- Invoice public-token expiry
-- =============================================================================
-- Adds an optional expiry date to the per-invoice capability token used by
-- the public /i/:token invoice view. NULL = no expiry (current behaviour,
-- kept for backward compatibility). Future: set to e.g. 365 days from
-- sent_at when the invoice email is dispatched.
--
-- The public invoice page already checks this column and shows an expired
-- state when public_token_expires_at < now().
--
-- Idempotent — safe to re-run.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_token_expires_at timestamptz;

COMMENT ON COLUMN public.invoices.public_token_expires_at IS
  'Optional expiry for the public_token shareable link. NULL = no expiry (backward-compatible default). The /i/:token page shows an expired notice when this is set and in the past.';
