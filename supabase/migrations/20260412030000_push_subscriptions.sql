-- Push notification subscriptions.
--
-- Each row stores a Web Push subscription object for a specific membership.
-- A single user can have multiple subscriptions (phone + laptop, etc).

create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  endpoint        text not null,
  keys_p256dh     text not null,
  keys_auth       text not null,
  created_at      timestamptz not null default now()
);

-- Unique on endpoint — the same browser can only subscribe once.
create unique index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_membership_idx
  on public.push_subscriptions (membership_id);

create index if not exists push_subscriptions_org_idx
  on public.push_subscriptions (organization_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

-- Members can read their own subscriptions.
create policy "members read own push subscriptions"
on public.push_subscriptions for select
using (
  membership_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- Members can insert their own subscriptions.
create policy "members insert own push subscriptions"
on public.push_subscriptions for insert
with check (
  membership_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- Members can delete their own subscriptions.
create policy "members delete own push subscriptions"
on public.push_subscriptions for delete
using (
  membership_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);
