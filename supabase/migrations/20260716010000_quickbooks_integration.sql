-- QuickBooks Online integration.
--
-- Most of the plumbing already exists: the integration_provider enum already
-- includes 'quickbooks', and clients.quickbooks_customer_id was added in the
-- original invoicing migration. This adds the two remaining pieces:
--   1. quickbooks_oauth_states — single-use CSRF tokens for the OAuth handshake
--      (same pattern as stripe/square/sage).
--   2. invoices.quickbooks_invoice_id — idempotency cache so re-syncing an
--      invoice returns the existing QBO invoice instead of duplicating it.

CREATE TABLE IF NOT EXISTS public.quickbooks_oauth_states (
  state            text        PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  membership_id    uuid        NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS quickbooks_oauth_states_expires_at_idx
  ON public.quickbooks_oauth_states (expires_at);

ALTER TABLE public.quickbooks_oauth_states ENABLE ROW LEVEL SECURITY;
-- No policies → deny-all for the authenticated role; service-role only, from
-- our own /api/integrations/quickbooks/* routes.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS quickbooks_invoice_id text;

CREATE INDEX IF NOT EXISTS invoices_quickbooks_invoice_id_idx
  ON public.invoices (quickbooks_invoice_id)
  WHERE quickbooks_invoice_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
