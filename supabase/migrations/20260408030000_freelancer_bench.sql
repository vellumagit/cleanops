-- =============================================================================
-- Sollos 3 — Phase 11 — Freelancer bench
-- =============================================================================
-- A "bench" of off-platform freelance cleaners that an admin can broadcast
-- a shift to by SMS. Freelancers do NOT have Sollos accounts — they are
-- just contact rows. When a shift needs coverage, the admin creates a
-- `job_offer` targeting N contacts. Each contact gets their own unique
-- `claim_token` (stored on `job_offer_dispatches`) that is embedded in the
-- outbound SMS. Tapping the link opens a no-login public claim page where
-- the first tap atomically fills the offer.
--
-- Design notes:
--   * Freelancers are an off-platform concern → NOT modeled as memberships.
--     No profile row, no auth.users row. Just a phone number and a name.
--   * The booking itself is unchanged. `bookings.assigned_to` stays null
--     when a freelancer takes the job — the link lives on
--     `job_offers.filled_contact_id` instead. (Option C from the plan.)
--   * Claim is first-to-win via an atomic `update ... where status='open'
--     returning *` guarded by RLS. See the server action, not the DB, for
--     the race handling.
--   * Twilio is not called from the DB. Dispatch rows carry a delivery
--     status that the server action writes. When TWILIO_ENABLED=false the
--     rows are created with delivery_status='skipped_disabled'.
--
-- RLS shape:
--   * freelancer_contacts  — admins/owners full access within their org
--   * job_offers           — admins/owners full access within their org
--   * job_offer_dispatches — admins/owners full access within their org
--
-- The /claim/:token page does NOT query these tables as an authenticated
-- user. It uses the service-role client to look up the dispatch by token,
-- then writes with the service-role client as well. The token itself is
-- the capability — 16 random bytes of entropy per dispatch.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- freelancer_contacts
-- -----------------------------------------------------------------------------

create table if not exists public.freelancer_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  full_name        text not null,
  phone            text not null,          -- E.164 format preferred, validated app-side
  email            text,
  notes            text,
  active           boolean not null default true,
  last_offered_at  timestamptz,
  last_accepted_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists freelancer_contacts_org_active_idx
  on public.freelancer_contacts (organization_id, active);

-- -----------------------------------------------------------------------------
-- job_offers
-- -----------------------------------------------------------------------------

create table if not exists public.job_offers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  booking_id         uuid not null references public.bookings(id) on delete cascade,
  posted_by          uuid not null references public.memberships(id),
  pay_cents          integer not null check (pay_cents >= 0),
  notes              text,
  status             text not null default 'open'
    check (status in ('open','filled','cancelled','expired')),
  expires_at         timestamptz,
  filled_contact_id  uuid references public.freelancer_contacts(id),
  filled_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists job_offers_org_status_idx
  on public.job_offers (organization_id, status);
create index if not exists job_offers_booking_idx
  on public.job_offers (booking_id);

-- -----------------------------------------------------------------------------
-- job_offer_dispatches
-- -----------------------------------------------------------------------------
-- One row per (offer, contact) combination. Carries the unique claim_token,
-- the Twilio delivery status, and — if this contact happened to claim the
-- offer — the responded_at timestamp. `delivery_status` values:
--   queued, sent, delivered, failed, skipped_disabled

create table if not exists public.job_offer_dispatches (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  offer_id          uuid not null references public.job_offers(id) on delete cascade,
  contact_id        uuid not null references public.freelancer_contacts(id) on delete cascade,
  claim_token       text not null unique,
  twilio_sid        text,
  delivery_status   text not null default 'queued',
  delivery_error    text,
  sent_at           timestamptz not null default now(),
  responded_at      timestamptz,
  unique (offer_id, contact_id)
);

create index if not exists job_offer_dispatches_offer_idx
  on public.job_offer_dispatches (offer_id);
create index if not exists job_offer_dispatches_token_idx
  on public.job_offer_dispatches (claim_token);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

create or replace function public.freelancer_contacts_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists freelancer_contacts_touch_updated_at on public.freelancer_contacts;
create trigger freelancer_contacts_touch_updated_at
  before update on public.freelancer_contacts
  for each row
  execute function public.freelancer_contacts_touch_updated_at();

create or replace function public.job_offers_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists job_offers_touch_updated_at on public.job_offers;
create trigger job_offers_touch_updated_at
  before update on public.job_offers
  for each row
  execute function public.job_offers_touch_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
-- Pattern A (admin-write, admin-read). Employees and lower roles do not see
-- the bench at all. Writes from the /claim/:token page bypass RLS via the
-- service-role client, which is the correct model because the freelancer
-- is not an authenticated user.

alter table public.freelancer_contacts  enable row level security;
alter table public.freelancer_contacts  force  row level security;
alter table public.job_offers           enable row level security;
alter table public.job_offers           force  row level security;
alter table public.job_offer_dispatches enable row level security;
alter table public.job_offer_dispatches force  row level security;

-- freelancer_contacts ---------------------------------------------------------

drop policy if exists "admins read freelancer_contacts" on public.freelancer_contacts;
create policy "admins read freelancer_contacts"
on public.freelancer_contacts for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins insert freelancer_contacts" on public.freelancer_contacts;
create policy "admins insert freelancer_contacts"
on public.freelancer_contacts for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update freelancer_contacts" on public.freelancer_contacts;
create policy "admins update freelancer_contacts"
on public.freelancer_contacts for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete freelancer_contacts" on public.freelancer_contacts;
create policy "admins delete freelancer_contacts"
on public.freelancer_contacts for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- job_offers ------------------------------------------------------------------

drop policy if exists "admins read job_offers" on public.job_offers;
create policy "admins read job_offers"
on public.job_offers for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins insert job_offers" on public.job_offers;
create policy "admins insert job_offers"
on public.job_offers for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update job_offers" on public.job_offers;
create policy "admins update job_offers"
on public.job_offers for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete job_offers" on public.job_offers;
create policy "admins delete job_offers"
on public.job_offers for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- job_offer_dispatches --------------------------------------------------------

drop policy if exists "admins read job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins read job_offer_dispatches"
on public.job_offer_dispatches for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins insert job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins insert job_offer_dispatches"
on public.job_offer_dispatches for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins update job_offer_dispatches"
on public.job_offer_dispatches for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins delete job_offer_dispatches"
on public.job_offer_dispatches for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

comment on table public.freelancer_contacts is
  'Off-platform freelance cleaners the org can broadcast shift offers to via SMS. NOT tied to auth.users.';

comment on table public.job_offers is
  'A shift broadcast to the freelancer bench. Filled atomically by the first claim on /claim/:token.';

comment on table public.job_offer_dispatches is
  'One row per (offer, contact) pair. Carries the unique claim_token that ties an inbound claim tap back to a specific freelancer.';
