-- =============================================================================
-- CleanOps Phase 1 — Auth + Multi-Tenancy Spine
-- =============================================================================
-- Creates the foundation for multi-tenant SaaS:
--   - organizations          (one row per cleaning company / tenant)
--   - profiles               (one row per auth.users, basic personal info)
--   - memberships            (which user belongs to which org and in what role)
--   - invitations            (pending invites to join an org)
--
-- Plus:
--   - Auto-create profile when a new auth.users row appears
--   - updated_at auto-touch trigger
--   - SECURITY DEFINER helper functions for RLS policies
--   - RLS enabled on every table with explicit policies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive text for emails

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type public.membership_role as enum ('owner', 'admin', 'employee');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('active', 'invited', 'disabled');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- updated_at touch helper
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Table: organizations
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(name) between 1 and 120),
  slug            citext unique not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: profiles
--
-- One row per auth.users. The id matches auth.users.id 1:1.
-- Profiles hold personal info that is the SAME across every org the user
-- belongs to (name, phone, avatar). Per-org info (role, pay rate) lives on
-- memberships, NOT here.
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text check (full_name is null or length(full_name) <= 120),
  phone           text check (phone is null or length(phone) <= 40),
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth.users row is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Table: memberships
--
-- The bridge table between profiles and organizations. Carries the user's
-- role within that specific org and any per-org metadata (pay rate, status).
-- A user can belong to many orgs; an org can have many users; (org, user) is
-- unique.
-- -----------------------------------------------------------------------------

create table if not exists public.memberships (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  role              public.membership_role not null,
  status            public.membership_status not null default 'active',
  pay_rate_cents    integer check (pay_rate_cents is null or pay_rate_cents >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index if not exists memberships_organization_id_idx on public.memberships (organization_id);
create index if not exists memberships_profile_id_idx on public.memberships (profile_id);

drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: invitations
--
-- Pending invites to join an org. The token is the URL-safe value emailed to
-- the invitee. When accepted, a membership row is created and the invitation
-- row keeps a record (accepted_at set) for audit purposes.
-- -----------------------------------------------------------------------------

create table if not exists public.invitations (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  email             citext not null,
  role              public.membership_role not null,
  token             text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by        uuid references public.profiles(id) on delete set null,
  expires_at        timestamptz not null default (now() + interval '14 days'),
  accepted_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists invitations_organization_id_idx on public.invitations (organization_id);
create index if not exists invitations_email_idx on public.invitations (email);

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER helper functions for RLS
--
-- These run with elevated privileges so they can read membership rows even
-- when called from a context where the caller would otherwise be blocked by
-- the recursive RLS check. They are SAFE because they ONLY read membership
-- data scoped to auth.uid() — they cannot leak data across users.
-- -----------------------------------------------------------------------------

-- Returns the set of organization IDs the current user is an active member of.
create or replace function public.current_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.memberships
  where profile_id = auth.uid()
    and status = 'active';
$$;

-- Returns true if the current user has any of the given roles in the given org.
create or replace function public.current_user_has_role(
  target_org uuid,
  allowed public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where profile_id = auth.uid()
      and organization_id = target_org
      and status = 'active'
      and role = any(allowed)
  );
$$;

-- Lock these down so only authenticated users can call them.
revoke all on function public.current_user_org_ids() from public;
grant execute on function public.current_user_org_ids() to authenticated;

revoke all on function public.current_user_has_role(uuid, public.membership_role[]) from public;
grant execute on function public.current_user_has_role(uuid, public.membership_role[]) to authenticated;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- Default deny on every table. Policies below explicitly grant the access
-- patterns the app needs.
-- =============================================================================

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;

-- Force RLS for the table owner too — safety net.
alter table public.organizations force row level security;
alter table public.profiles      force row level security;
alter table public.memberships   force row level security;
alter table public.invitations   force row level security;

-- -----------------------------------------------------------------------------
-- Policies: organizations
-- -----------------------------------------------------------------------------

drop policy if exists "members can read their orgs" on public.organizations;
create policy "members can read their orgs"
on public.organizations for select
to authenticated
using (id in (select public.current_user_org_ids()));

drop policy if exists "owners can update their org" on public.organizations;
create policy "owners can update their org"
on public.organizations for update
to authenticated
using (public.current_user_has_role(id, array['owner']::public.membership_role[]))
with check (public.current_user_has_role(id, array['owner']::public.membership_role[]));

-- Note: INSERT into organizations is performed by a server action that uses
-- the service-role client (bypasses RLS). We do NOT expose org creation to
-- the anon/auth role directly because creating an org also requires creating
-- the owner membership atomically.

-- -----------------------------------------------------------------------------
-- Policies: profiles
-- -----------------------------------------------------------------------------

-- Users can always read and update their OWN profile.
drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Members can read profiles of other members of orgs they share.
drop policy if exists "members can read profiles in shared orgs" on public.profiles;
create policy "members can read profiles in shared orgs"
on public.profiles for select
to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.profile_id = profiles.id
      and m.organization_id in (select public.current_user_org_ids())
      and m.status = 'active'
  )
);

-- INSERT happens automatically via the on_auth_user_created trigger
-- (SECURITY DEFINER), so no INSERT policy is needed for the auth role.

-- -----------------------------------------------------------------------------
-- Policies: memberships
-- -----------------------------------------------------------------------------

-- Members can see other memberships in their orgs (so admins can manage staff,
-- and employees can see who their teammates are).
drop policy if exists "members can read memberships in their orgs" on public.memberships;
create policy "members can read memberships in their orgs"
on public.memberships for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

-- Only owners and admins can create new memberships.
drop policy if exists "owners and admins can insert memberships" on public.memberships;
create policy "owners and admins can insert memberships"
on public.memberships for insert
to authenticated
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- Owners and admins can update memberships in their org (change role, deactivate).
drop policy if exists "owners and admins can update memberships" on public.memberships;
create policy "owners and admins can update memberships"
on public.memberships for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- Owners can delete memberships (effectively removing a user from the org).
drop policy if exists "owners can delete memberships" on public.memberships;
create policy "owners can delete memberships"
on public.memberships for delete
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner']::public.membership_role[])
);

-- -----------------------------------------------------------------------------
-- Policies: invitations
-- -----------------------------------------------------------------------------

-- Owners and admins can read invitations for their orgs.
drop policy if exists "owners and admins can read invitations" on public.invitations;
create policy "owners and admins can read invitations"
on public.invitations for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- Owners and admins can create invitations.
drop policy if exists "owners and admins can insert invitations" on public.invitations;
create policy "owners and admins can insert invitations"
on public.invitations for insert
to authenticated
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- Owners and admins can delete invitations (revoke).
drop policy if exists "owners and admins can delete invitations" on public.invitations;
create policy "owners and admins can delete invitations"
on public.invitations for delete
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- =============================================================================
-- Comments — for future humans (and LLMs) reading the schema
-- =============================================================================

comment on table public.organizations is
  'Tenants. One row per cleaning company. The root of multi-tenancy.';

comment on table public.profiles is
  'One row per auth.users. Personal info shared across all orgs the user belongs to.';

comment on table public.memberships is
  'Bridge table between profiles and organizations. Carries role and per-org metadata.';

comment on table public.invitations is
  'Pending invites to join an org. accepted_at is set when the invitee redeems the token.';

comment on function public.current_user_org_ids() is
  'Returns the set of org IDs the current user actively belongs to. SECURITY DEFINER. Used in RLS policies.';

comment on function public.current_user_has_role(uuid, public.membership_role[]) is
  'Returns true if the current user has any of the given roles in the given org. SECURITY DEFINER. Used in RLS policies.';
