-- Webhook subscriptions + delivery log.
-- Subscriptions define which URLs receive which events.
-- Deliveries track every attempt for debugging and monitoring.

-- ── Subscriptions ──────────────────────────────────────────────

create table if not exists public.webhook_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type    text not null,
  target_url    text not null,
  secret        text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists webhook_subs_org_event_idx
  on public.webhook_subscriptions (organization_id, event_type)
  where active = true;

alter table public.webhook_subscriptions enable row level security;

-- Only org admins/owners can manage subscriptions (via RLS)
create policy "members can view own org webhook subscriptions"
  on public.webhook_subscriptions for select
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "admins can manage webhook subscriptions"
  on public.webhook_subscriptions for all
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner', 'admin')
    )
  );

-- ── Delivery log ───────────────────────────────────────────────

create table if not exists public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  event_id        text not null,
  event_type      text not null,
  target_url      text not null,
  attempt         smallint not null default 1,
  status_code     smallint,
  success         boolean not null default false,
  error_message   text,
  duration_ms     integer,
  payload_size    integer,
  created_at      timestamptz not null default now()
);

-- Recent deliveries by subscription (for the settings UI)
create index if not exists webhook_del_sub_created_idx
  on public.webhook_deliveries (subscription_id, created_at desc);

-- Org-wide delivery log
create index if not exists webhook_del_org_created_idx
  on public.webhook_deliveries (organization_id, created_at desc);

-- Dedupe / lookup by event
create index if not exists webhook_del_event_idx
  on public.webhook_deliveries (event_id);

alter table public.webhook_deliveries enable row level security;

-- Admin client writes deliveries; members can view their org's log
create policy "members can view own org webhook deliveries"
  on public.webhook_deliveries for select
  using (
    organization_id in (
      select m.organization_id from public.memberships m
      where m.profile_id = auth.uid()
        and m.status = 'active'
    )
  );

comment on table public.webhook_subscriptions is
  'Per-org outbound webhook subscriptions. Each row registers a URL to receive a specific event type.';
comment on table public.webhook_deliveries is
  'Append-only log of every webhook delivery attempt, including retries, for debugging and monitoring.';
