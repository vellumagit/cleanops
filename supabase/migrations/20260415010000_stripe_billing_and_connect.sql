-- =============================================================================
-- Stripe — full billing + Connect wiring
-- =============================================================================
-- This migration finishes the work that was scaffolded back in Phase 10.
--
-- It adds:
--   1. `plan_tier` + helpful columns to `subscriptions` (Sollos 3 SaaS billing)
--   2. `stripe_events` for idempotent webhook processing
--   3. Connect columns on `organizations`
--   4. `stripe_oauth_states` — short-lived CSRF tokens for the Connect flow
--   5. Invoice columns for Stripe-hosted payment collection
--
-- All mutations happen via server actions using the service-role client.
-- RLS is still enforced for reads by member users.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. subscriptions: add plan_tier so the app doesn't have to map price IDs
-- -----------------------------------------------------------------------------

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_tier text
    CHECK (plan_tier IN ('starter','growth','enterprise')),
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS last_event_id text;

-- -----------------------------------------------------------------------------
-- 2. stripe_events — idempotency table for webhook processing
-- -----------------------------------------------------------------------------
-- Stripe can (and does) deliver the same event more than once. We store every
-- event.id we've processed; the webhook handler short-circuits on duplicates.
-- Small cardinality (events age out after ~90 days — add a cron later).

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id             text PRIMARY KEY,        -- Stripe event ID (evt_...)
  type           text NOT NULL,
  account_id     text,                    -- set for Connect events
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS stripe_events_received_at_idx
  ON public.stripe_events (received_at);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events FORCE  ROW LEVEL SECURITY;
-- No policies — service-role only.

-- -----------------------------------------------------------------------------
-- 3. organizations — Stripe Connect fields
-- -----------------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_account_id           text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_account_type         text
    CHECK (stripe_account_type IN ('standard','express','custom')),
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connected_at         timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_disconnected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_application_fee_bps  integer NOT NULL DEFAULT 0
    CHECK (stripe_application_fee_bps >= 0 AND stripe_application_fee_bps <= 10000);

COMMENT ON COLUMN public.organizations.stripe_application_fee_bps IS
  'Platform fee in basis points (1 bp = 0.01%). 0 = no fee. 250 = 2.5%.';

-- -----------------------------------------------------------------------------
-- 4. stripe_oauth_states — short-lived CSRF tokens
-- -----------------------------------------------------------------------------
-- Before redirecting a user to Stripe's OAuth consent screen, we generate a
-- random state value, store it here, and include it in the redirect URL.
-- On callback we look it up and delete it. If the state doesn't match, we
-- reject the callback — prevents an attacker from tricking someone's browser
-- into connecting an attacker's Stripe account to the victim's org.

CREATE TABLE IF NOT EXISTS public.stripe_oauth_states (
  state            text PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id    uuid NOT NULL REFERENCES public.memberships(id)   ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS stripe_oauth_states_expires_idx
  ON public.stripe_oauth_states (expires_at);

ALTER TABLE public.stripe_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_oauth_states FORCE  ROW LEVEL SECURITY;
-- No policies — service-role only.

-- -----------------------------------------------------------------------------
-- 5. invoices — Stripe-hosted payment collection
-- -----------------------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   text,
  ADD COLUMN IF NOT EXISTS stripe_payment_url         text,
  ADD COLUMN IF NOT EXISTS stripe_paid_at             timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_fee_cents           integer;

CREATE INDEX IF NOT EXISTS invoices_stripe_session_idx
  ON public.invoices (stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS invoices_stripe_pi_idx
  ON public.invoices (stripe_payment_intent_id);

-- -----------------------------------------------------------------------------
-- 6. Cleanup helper — cron can call this to expire old OAuth state tokens
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_expired_stripe_oauth_states()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.stripe_oauth_states WHERE expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

COMMENT ON TABLE public.stripe_events        IS 'Idempotency ledger for Stripe webhook events.';
COMMENT ON TABLE public.stripe_oauth_states  IS 'Short-lived CSRF tokens for the Stripe Connect OAuth flow. Expire in 10 minutes.';
