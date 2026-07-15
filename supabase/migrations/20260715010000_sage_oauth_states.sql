-- Single-use CSRF state tokens for the Sage OAuth handshake.
--
-- Previously the Sage connect flow passed the membership id as the OAuth
-- `state` param — a stable, non-random value. That's a weaker CSRF guard than
-- the Stripe/Square flows (which mint a random single-use token). This table
-- brings Sage to parity: a random token is issued at connect time, tied to
-- (org, membership), consumed once at callback, and expires in 10 minutes.

CREATE TABLE IF NOT EXISTS public.sage_oauth_states (
  state            text        PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id    uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS sage_oauth_states_expires_at_idx
  ON public.sage_oauth_states (expires_at);

ALTER TABLE public.sage_oauth_states ENABLE ROW LEVEL SECURITY;

-- No policies → deny-all for the `authenticated` role. Reads/writes happen only
-- via the service role inside our own /api/integrations/sage/* routes.

NOTIFY pgrst, 'reload schema';
