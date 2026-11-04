-- ============================================================
-- Client media — photos and videos of a client's home
-- ============================================================
--
-- Svitlana's 2026-11-03 ask: when quoting she asks the client for photos
-- and videos of the home (and where the key is). Those belong with the
-- client so whoever cleans there next, a new cleaner included, sees them,
-- and so there's a record of the state the home was in before the team
-- arrived. Different from job photos (before/after, taken ON the job) and
-- from client documents (manager-only paperwork): cleaners see these.
--
-- booking_id is optional: null = about the home in general, shown on every
-- visit; set = attached to one booking (shown on that booking only).
--
-- Files go from the phone straight to storage on a one-time signed upload
-- URL, not through a server action: Vercel caps a request at 4.5 MB and a
-- phone video is far bigger. All row writes go through service-role server
-- actions that check the manager role, so there is no write policy here.

create table if not exists public.client_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id)       on delete cascade,
  booking_id      uuid references public.bookings(id)               on delete set null,
  storage_path    text not null unique,
  media_type      text not null check (media_type in ('photo', 'video')),
  mime_type       text not null,
  size_bytes      bigint,
  caption         text,
  uploaded_by     uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists client_media_client_idx  on public.client_media (client_id, created_at desc);
create index if not exists client_media_booking_idx on public.client_media (booking_id) where booking_id is not null;
create index if not exists client_media_org_idx     on public.client_media (organization_id);

alter table public.client_media enable row level security;

-- Every active member of the org may read: the cleaner going to the home
-- is exactly who these are for.
drop policy if exists client_media_select on public.client_media;
create policy client_media_select
  on public.client_media
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = client_media.organization_id
        and m.profile_id = auth.uid()
        and m.status = 'active'
    )
  );

-- ============================================================
-- Private bucket. Reads are signed URLs made on the server; uploads are
-- one-time signed upload URLs made on the server after the role check.
-- 50 MB per file: the default ceiling for a single upload on a Supabase
-- project, and about 30 seconds of 1080p phone video. Raise both together
-- (Storage settings, then this limit) if longer videos are wanted.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-media',
  'client-media',
  false,
  52428800, -- 50 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/3gpp'
  ]
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
