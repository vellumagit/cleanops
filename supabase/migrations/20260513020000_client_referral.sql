-- Client referral tracking.
--
-- Allows recording which existing client referred a new one.
-- The column was added manually to the live DB without a migration;
-- this backfills it for any fresh restore or new environment.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS referred_by_client_id uuid
    REFERENCES public.clients (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.clients.referred_by_client_id IS
  'The existing client who referred this one. Self-referral is prevented at the application layer.';

-- Index for the reverse lookup: "which clients did this person refer?"
CREATE INDEX IF NOT EXISTS clients_referred_by_client_id_idx
  ON public.clients (referred_by_client_id)
  WHERE referred_by_client_id IS NOT NULL;
