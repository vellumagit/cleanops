-- Automation preferences per org (empty object = all automations enabled)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS automation_settings jsonb NOT NULL DEFAULT '{}';

-- Webhook endpoints table
CREATE TABLE IF NOT EXISTS public.webhooks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  url             text        NOT NULL CHECK (url LIKE 'https://%'),
  secret          text        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  events          text[]      NOT NULL DEFAULT '{}',
  is_active       boolean     NOT NULL DEFAULT true,
  created_by      uuid        REFERENCES public.memberships(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz,
  last_status_code  int
);

CREATE INDEX IF NOT EXISTS webhooks_org_idx ON public.webhooks(organization_id);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_webhooks"
  ON public.webhooks FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "org_owners_admin_manage_webhooks"
  ON public.webhooks FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE profile_id = auth.uid()
        AND status = 'active'
        AND role IN ('owner', 'admin')
    )
  );
