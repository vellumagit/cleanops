-- Per-client billing cadence and type
--
-- billing_cadence: when consolidated invoices are generated
--   on_demand  — existing behaviour: one invoice per job (auto-invoice automation)
--   biweekly   — one invoice on the 1st and one on the 15th every month
--   monthly    — one invoice on the 1st of every month
--
-- billing_type: how line items are built for biweekly/monthly clients
--   itemized   — one line item per completed booking in the period
--   flat_rate  — single retainer line item (flat_rate_cents), all bookings
--                listed in the invoice notes
--
-- flat_rate_cents: the fixed amount charged per billing period when
--   billing_type = 'flat_rate'. NULL is valid for itemized clients.
--
-- bookings.billing_invoice_id: once a booking is included in a
--   consolidated invoice it is stamped here so subsequent cron runs
--   skip it (dedup). On DELETE SET NULL so voiding the invoice lets it
--   be re-billed.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_cadence text NOT NULL DEFAULT 'on_demand'
    CHECK (billing_cadence IN ('on_demand', 'biweekly', 'monthly'));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'itemized'
    CHECK (billing_type IN ('itemized', 'flat_rate'));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS flat_rate_cents integer;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS billing_invoice_id uuid
    REFERENCES public.invoices(id) ON DELETE SET NULL;

-- Index for the cron's unbilled-bookings scan: (client_id, billing_invoice_id)
-- so Postgres can satisfy WHERE client_id = $1 AND billing_invoice_id IS NULL
-- without a seq scan on bookings.
CREATE INDEX IF NOT EXISTS bookings_billing_invoice_id_idx
  ON public.bookings (client_id, billing_invoice_id)
  WHERE billing_invoice_id IS NULL;

COMMENT ON COLUMN public.clients.billing_cadence IS
  'When invoices are generated: on_demand (per-job), biweekly (1st+15th), monthly (1st only).';
COMMENT ON COLUMN public.clients.billing_type IS
  'How billing-cycle invoices are structured: itemized (per booking) or flat_rate (retainer).';
COMMENT ON COLUMN public.clients.flat_rate_cents IS
  'Amount charged per billing period when billing_type = ''flat_rate''. NULL for itemized clients.';
COMMENT ON COLUMN public.bookings.billing_invoice_id IS
  'Set when this booking is included in a consolidated billing-cycle invoice. NULL = unbilled.';
