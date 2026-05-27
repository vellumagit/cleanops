-- Add 'refunded' to invoice_status enum so the Stripe Connect refund
-- webhook can flip an invoice to a status that clearly indicates the
-- money came back, rather than the previous behavior of flipping back
-- to 'draft' (which looked like a fresh unsent invoice and would
-- include it in revenue reports / let it be re-sent).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'refunded'
      AND enumtypid = 'public.invoice_status'::regtype
  ) THEN
    ALTER TYPE public.invoice_status ADD VALUE 'refunded';
  END IF;
END $$;
