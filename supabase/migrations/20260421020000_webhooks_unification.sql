-- Webhook schema unification
--
-- Two webhook tables have existed side-by-side since 2026-04-18:
--   - public.webhook_subscriptions  (2026-04-13, single event per row)
--   - public.webhooks               (2026-04-18, events[] array per row,
--                                    what the settings UI writes to)
--
-- The dispatcher (src/lib/webhooks.ts) was reading from webhook_subscriptions
-- while the settings UI (/app/settings/webhooks) wrote to webhooks. The feature
-- has therefore been non-functional since 04-18: no user-configured webhook
-- has ever fired.
--
-- Consequence: both webhook_subscriptions and webhook_deliveries are empty
-- in practice. This migration drops the dead tables and rebuilds
-- webhook_deliveries pointing at the live webhooks table.

-- 1. Drop the orphaned table and its delivery log (CASCADE takes both).
DROP TABLE IF EXISTS public.webhook_subscriptions CASCADE;
-- Belt-and-suspenders: drop the deliveries table explicitly in case the
-- FK above was already broken from a prior manual edit.
DROP TABLE IF EXISTS public.webhook_deliveries CASCADE;

-- 2. Recreate the deliveries log, now referencing the webhooks table.
CREATE TABLE public.webhook_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  webhook_id      uuid        NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event_id        text        NOT NULL,
  event_type      text        NOT NULL,
  target_url      text        NOT NULL,
  attempt         smallint    NOT NULL DEFAULT 1,
  status_code     smallint,
  success         boolean     NOT NULL DEFAULT false,
  error_message   text,
  duration_ms     integer,
  payload_size    integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_idx
  ON public.webhook_deliveries (webhook_id, created_at DESC);

CREATE INDEX webhook_deliveries_org_idx
  ON public.webhook_deliveries (organization_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Only owners/admins can see deliveries (they configure webhooks and
-- need to debug them). Managers and employees don't need this.
CREATE POLICY "org_admins_read_webhook_deliveries"
  ON public.webhook_deliveries FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.memberships
    WHERE profile_id = auth.uid() AND status = 'active'
      AND role IN ('owner', 'admin')
  ));

-- Writes are service-role only (from the dispatcher). No INSERT policy for
-- authenticated role, which effectively blocks client writes.
