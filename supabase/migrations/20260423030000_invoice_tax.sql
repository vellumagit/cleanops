-- =============================================================================
-- Invoice tax (GST / HST / VAT / Sales tax)
-- =============================================================================
-- Adds an optional tax line to every invoice. The existing `amount_cents`
-- keeps its current meaning ("grand total the client owes") so every
-- existing query, export, dashboard widget, and reporting path keeps
-- working without change. New columns:
--
--   tax_rate_bps     — rate in basis points (500 = 5.00%). NULL = no
--                      tax on this invoice. Stored as int to dodge
--                      float rounding.
--   tax_amount_cents — the tax portion of amount_cents. Stored (not
--                      computed) so changing the org default later
--                      doesn't rewrite historical invoices.
--   tax_label        — "GST", "HST", "VAT", "Sales tax", etc. What the
--                      client sees on the invoice line.
--
-- The subtotal is derived as `amount_cents - COALESCE(tax_amount_cents, 0)`.
-- No separate subtotal column — it'd be redundant and drift-prone.
--
-- Org-level defaults live on organizations so new invoices can pre-fill
-- without the owner retyping 5% every time.
-- =============================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_rate_bps      int,
  ADD COLUMN IF NOT EXISTS tax_amount_cents  int,
  ADD COLUMN IF NOT EXISTS tax_label         text;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_tax_rate_bps  int,
  ADD COLUMN IF NOT EXISTS default_tax_label     text;

-- Sanity: rate must be non-negative and under 100% if set. 99.99% = 9999.
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_tax_rate_bps_range
  CHECK (tax_rate_bps IS NULL OR (tax_rate_bps >= 0 AND tax_rate_bps <= 9999));

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_default_tax_rate_bps_range
  CHECK (default_tax_rate_bps IS NULL OR (default_tax_rate_bps >= 0 AND default_tax_rate_bps <= 9999));

COMMENT ON COLUMN public.invoices.tax_rate_bps IS
  'Tax rate for this invoice in basis points (500 = 5%). NULL means no tax.';
COMMENT ON COLUMN public.invoices.tax_amount_cents IS
  'Tax portion of amount_cents. Frozen at save-time for historical accuracy.';
COMMENT ON COLUMN public.invoices.tax_label IS
  'Label shown to the client on the invoice — "GST", "HST", "VAT", etc.';
COMMENT ON COLUMN public.organizations.default_tax_rate_bps IS
  'Default tax rate (bps) pre-filled on new invoices. NULL = no default.';
COMMENT ON COLUMN public.organizations.default_tax_label IS
  'Default tax label ("GST" etc.) pre-filled on new invoices.';
