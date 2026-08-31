-- Weekly billing cadence.
--
-- Svitlana's Aug 30 ask: invoice some clients every week, not only
-- biweekly/monthly. Weekly is ANCHORED-ONLY by design — it exists after
-- the anchor model, so there is no "legacy 1st/15th" behaviour to
-- preserve: a weekly client sets billing_anchor_date and bills in exact
-- 7-day cycles from it (key prefix anchor-weekly:, same idempotency
-- machinery as the other cadences). The app requires the anchor date at
-- the form layer; a weekly client that somehow lacks one is a safe
-- no-op in the cron, never a mis-keyed invoice.
--
-- The CHECK was added inline with the column (20260427010000), so it
-- carries the default constraint name.

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_billing_cadence_check;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_billing_cadence_check
    CHECK (billing_cadence IN ('on_demand', 'weekly', 'biweekly', 'monthly'));

COMMENT ON COLUMN public.clients.billing_cadence IS
  'When invoices are generated: on_demand (per-job), weekly (anchored 7-day cycles), biweekly (1st+15th or anchored 14-day cycles), monthly (1st or anchored day).';

notify pgrst, 'reload schema';
