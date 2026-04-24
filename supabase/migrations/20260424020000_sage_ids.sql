-- =============================================================================
-- Sage Accounting: idempotency ids on clients + invoices
-- =============================================================================
-- Once we push a client → Sage contact or an invoice → Sage sales invoice,
-- we stash the Sage-side id here so subsequent attempts don't create
-- duplicate records in the books. The sync functions check these
-- columns before POST-ing a new object.
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sage_contact_id text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sage_invoice_id text;

-- Lookup: "which Sollos client maps to this Sage contact?" is a webhook
-- use case once we listen to Sage for two-way sync. Partial index skips
-- the majority of rows that haven't been synced yet.
CREATE INDEX IF NOT EXISTS clients_sage_contact_id_idx
  ON public.clients (sage_contact_id)
  WHERE sage_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_sage_invoice_id_idx
  ON public.invoices (sage_invoice_id)
  WHERE sage_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.clients.sage_contact_id IS
  'Sage Business Cloud Accounting contact id. Set once by pushClientToSage, used to detect already-synced and skip duplicate creates.';
COMMENT ON COLUMN public.invoices.sage_invoice_id IS
  'Sage Business Cloud Accounting sales invoice id. Set once by pushInvoiceToSage.';
