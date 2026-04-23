-- Client portal
--
-- Today clients see only one-off token links (public invoices, estimates,
-- review forms). This migration gives them a proper persistent login so
-- they can see their full history, upcoming jobs, and outstanding
-- invoices in one place.
--
-- Design:
--   - Extend public.clients with an optional profile_id → auth.users.
--     Clients remain org-scoped; linking to an auth user just unlocks
--     the portal. Partial unique index so one auth account maps to at
--     most one client.
--   - Portal invite flow: owner clicks "Invite to portal" → server
--     stamps invite_token + expiry on the client row → client gets an
--     email with /client/claim/<token> → they set a password and the
--     auth user is created or linked.
--   - RLS policies on bookings, invoices, reviews let an authenticated
--     client (profile_id match) read the rows that belong to their
--     client record.

-- -----------------------------------------------------------------------------
-- CLIENTS: link to auth + invite flow columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_invite_token text,
  ADD COLUMN IF NOT EXISTS portal_invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_accepted_at timestamptz;

-- A single auth account can link to one client record per org. We don't
-- enforce cross-org uniqueness because the same person could be a client
-- of multiple cleaning companies using Sollos.
CREATE UNIQUE INDEX IF NOT EXISTS clients_profile_id_per_org_uniq
  ON public.clients (organization_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- Quick lookup from token to client during the claim flow.
CREATE INDEX IF NOT EXISTS clients_portal_invite_token_idx
  ON public.clients (portal_invite_token)
  WHERE portal_invite_token IS NOT NULL;

COMMENT ON COLUMN public.clients.profile_id IS
  'Linked auth user (via profiles). When set, the client can log in at /client/login and see their data.';

-- -----------------------------------------------------------------------------
-- RLS additions so an authenticated client (profile_id = auth.uid()) can
-- read their own data. Owner/manager policies stay intact; we're ADDING
-- new SELECT policies, not replacing anything.
-- -----------------------------------------------------------------------------

-- Clients can read their own client row.
DROP POLICY IF EXISTS "clients_read_self" ON public.clients;
CREATE POLICY "clients_read_self"
  ON public.clients FOR SELECT
  USING (profile_id = auth.uid());

-- Bookings: a client can read any booking whose client_id belongs to them.
DROP POLICY IF EXISTS "clients_read_own_bookings" ON public.bookings;
CREATE POLICY "clients_read_own_bookings"
  ON public.bookings FOR SELECT
  USING (client_id IN (
    SELECT id FROM public.clients WHERE profile_id = auth.uid()
  ));

-- Invoices: same idea.
DROP POLICY IF EXISTS "clients_read_own_invoices" ON public.invoices;
CREATE POLICY "clients_read_own_invoices"
  ON public.invoices FOR SELECT
  USING (client_id IN (
    SELECT id FROM public.clients WHERE profile_id = auth.uid()
  ));

-- Invoice line items: follow the parent invoice. Only fire if the
-- invoice_line_items table exists (older installs may not).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'invoice_line_items'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "clients_read_own_invoice_line_items" ON public.invoice_line_items';
    EXECUTE $pol$
      CREATE POLICY "clients_read_own_invoice_line_items"
        ON public.invoice_line_items FOR SELECT
        USING (invoice_id IN (
          SELECT i.id FROM public.invoices i
          JOIN public.clients c ON c.id = i.client_id
          WHERE c.profile_id = auth.uid()
        ))
    $pol$;
  END IF;
END $$;

-- Invoice payments: a client can see payments on their own invoices.
DROP POLICY IF EXISTS "clients_read_own_invoice_payments" ON public.invoice_payments;
CREATE POLICY "clients_read_own_invoice_payments"
  ON public.invoice_payments FOR SELECT
  USING (invoice_id IN (
    SELECT i.id FROM public.invoices i
    JOIN public.clients c ON c.id = i.client_id
    WHERE c.profile_id = auth.uid()
  ));

-- Reviews the client has left.
DROP POLICY IF EXISTS "clients_read_own_reviews" ON public.reviews;
CREATE POLICY "clients_read_own_reviews"
  ON public.reviews FOR SELECT
  USING (client_id IN (
    SELECT id FROM public.clients WHERE profile_id = auth.uid()
  ));
