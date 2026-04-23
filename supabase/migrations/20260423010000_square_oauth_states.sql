-- Square OAuth state table — one-time CSRF tokens for the OAuth handshake.
--
-- Square Connect uses the same pattern as Stripe Connect:
--   1. Owner clicks "Connect Square" in Settings → Integrations
--   2. We issue a random token, store it with (org, membership, expires_at)
--   3. Redirect the user to Square's authorize URL with the token in `state`
--   4. Square redirects back to /api/integrations/square/callback
--   5. Callback validates the state token, consumes it, and exchanges the
--      authorization code for access + refresh tokens
--
-- Storing the state in a table (vs. a signed JWT in the URL) gives us:
--   - Guaranteed one-time-use (deleted on consume)
--   - Easy expiry enforcement
--   - Free audit trail (we can see who tried to connect when)
--
-- 10-minute TTL matches stripe_oauth_states and covers any reasonable
-- OAuth round-trip even with 2FA prompts.

CREATE TABLE IF NOT EXISTS public.square_oauth_states (
  state            text        PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id    uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS square_oauth_states_expires_at_idx
  ON public.square_oauth_states (expires_at);

ALTER TABLE public.square_oauth_states ENABLE ROW LEVEL SECURITY;

-- No client-side access to this table — reads/writes only via the service
-- role inside our own /api/integrations/square/* routes. RLS without any
-- policies is an effective deny-all for the `authenticated` role.

-- ---------------------------------------------------------------------------
-- Invoices: Square Payment Link tracking
-- ---------------------------------------------------------------------------
--
-- When a "Pay with Square" button is clicked on the public invoice page,
-- we call Square's Online Checkout API to mint a Payment Link and stash
-- its id/url on the invoice. The webhook later reconciles by matching the
-- Square order_id (set on the order that backs the payment link) to a row
-- here.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS square_payment_link_id  text,
  ADD COLUMN IF NOT EXISTS square_payment_link_url text,
  ADD COLUMN IF NOT EXISTS square_order_id         text;

-- Lookup from webhook order_id → invoice. Partial so inserts without a
-- Square order are allowed.
CREATE INDEX IF NOT EXISTS invoices_square_order_idx
  ON public.invoices (square_order_id)
  WHERE square_order_id IS NOT NULL;
