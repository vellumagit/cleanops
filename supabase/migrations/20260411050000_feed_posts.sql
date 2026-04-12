-- =============================================================================
-- Migration: Feed posts — social-media-style team announcements
-- Managers/admins post updates, everyone on the team sees them.
-- =============================================================================

create table if not exists public.feed_posts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  author_id         uuid not null references public.memberships(id) on delete cascade,
  body              text not null check (length(body) between 1 and 5000),
  image_url         text,                        -- optional image attachment
  pinned            boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists feed_posts_org_created_idx
  on public.feed_posts (organization_id, created_at desc);

create index if not exists feed_posts_pinned_idx
  on public.feed_posts (organization_id, pinned)
  where pinned = true;

-- Enable realtime for live feed updates
alter publication supabase_realtime add table public.feed_posts;

-- RLS policies
alter table public.feed_posts enable row level security;

-- All active members can read feed posts in their org
create policy "members can read feed posts"
on public.feed_posts for select
using (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- Only owner/admin/manager can create posts
create policy "managers can create feed posts"
on public.feed_posts for insert
with check (
  organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'manager')
  )
  and author_id in (
    select id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
  )
);

-- Authors can delete their own posts, admins can delete any
create policy "authors and admins can delete feed posts"
on public.feed_posts for delete
using (
  author_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  or organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin')
  )
);

-- Authors can update their own posts (pin/unpin, edit body)
create policy "authors can update feed posts"
on public.feed_posts for update
using (
  author_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  or organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin')
  )
);
