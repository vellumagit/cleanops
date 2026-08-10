-- =============================================================================
-- Client properties: one client, many places
-- supabase/migrations/20260810010000_client_properties.sql
-- =============================================================================
-- Sollos assumes a client IS an address. clients.address is a single text
-- column, and a job's location is bookings.address -- a free-text snapshot
-- typed fresh each time.
--
-- That assumption breaks on the first customer who owns more than one
-- building. An Airbnb host with four properties is one payer, one balance,
-- one contact, and four completely different front doors, each with its own
-- lockbox code and its own checklist.
--
-- It is also ALREADY breaking at Svit's current scale, quietly. Ten clients
-- are booked at more than one "address", and almost none of them are actually
-- second properties -- they are the same house retyped:
--
--   Carol and Rick   "15935 107A Ane NW"          <- typo
--                    "15935 107A Ave NW"
--                    "15935 107A Avenue Northwest, Edmonton, AB, Canada"
--
-- A free-text box invites that every single time a booking is made. Four
-- properties booked weekly is roughly 200 chances a year to send a cleaner to
-- the wrong door.
--
-- So the address stops being a string someone types and becomes a row someone
-- picks. bookings.address is deliberately LEFT IN PLACE and still wins when
-- set: it is the historical record of where a past job actually happened, and
-- rewriting it would falsify completed work and the invoices drawn from it.
-- property_id is additive -- new bookings point at a property, old bookings
-- keep their snapshot, and nothing has to be migrated for the app to work.
-- =============================================================================


-- -- 1. The table ---------------------------------------------------------------

create table if not exists public.client_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  client_id uuid not null
    references public.clients (id) on delete cascade,

  -- What a human calls it: "Whyte Ave suite", "the duplex", "Unit 3".
  -- Required, because "which one is 10815?" is the question this table exists
  -- to stop anyone having to ask.
  label text not null,

  address text,

  -- Lockbox codes, gate codes, "key is under the planter", parking stall.
  -- The single most common reason a turnover clean fails is the cleaner
  -- standing outside unable to get in. Shown on the field job screen.
  --
  -- SENSITIVE. This is literally how to enter someone's home. RLS below
  -- scopes it to the org, and it must never be added to a client-portal or
  -- public-token query without a deliberate decision -- see section 5.
  access_notes text,

  -- Overrides clients.default_checklist_template_id for jobs at this
  -- property. A studio turnover and a four-bedroom are not the same clean.
  default_checklist_template_id uuid
    references public.checklist_templates (id) on delete set null,

  notes text,

  -- Soft delete, matching clients.archived_at. A property with booking
  -- history must never hard-delete out from under those bookings.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two properties called "Unit A" under one client is a data-entry mistake, not
-- a use case. Partial, so an archived property frees its name for reuse.
create unique index if not exists client_properties_client_label_key
  on public.client_properties (client_id, lower(label))
  where archived_at is null;

create index if not exists client_properties_client_idx
  on public.client_properties (client_id)
  where archived_at is null;

create index if not exists client_properties_org_idx
  on public.client_properties (organization_id);

-- Composite key so bookings/series can FK on (property_id, organization_id)
-- and the database itself refuses to attach org A's property to org B's job.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_properties_id_org_key'
      and conrelid = 'public.client_properties'::regclass
  ) then
    alter table public.client_properties
      add constraint client_properties_id_org_key unique (id, organization_id);
  end if;
end $$;

drop trigger if exists set_client_properties_updated_at on public.client_properties;
create trigger set_client_properties_updated_at
  before update on public.client_properties
  for each row execute function public.set_updated_at();


-- -- 2. bookings.property_id ----------------------------------------------------

alter table public.bookings
  add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_property_org_fk'
      and conrelid = 'public.bookings'::regclass
  ) then
    -- ON DELETE is NOT specified (NO ACTION) on purpose: a property with jobs
    -- against it cannot be hard-deleted, which is why archived_at exists. The
    -- org-delete cascade still completes, because NO ACTION is checked at end
    -- of statement -- the same reasoning as the payables FKs in
    -- 20260808010000.
    alter table public.bookings
      add constraint bookings_property_org_fk
        foreign key (property_id, organization_id)
        references public.client_properties (id, organization_id);
  end if;
end $$;

create index if not exists bookings_property_idx
  on public.bookings (property_id)
  where property_id is not null;


-- -- 3. booking_series.property_id ----------------------------------------------
-- The series is where multi-property actually pays off: one series per
-- property means the address is chosen ONCE and every generated booking
-- inherits it, instead of being retyped weekly. The generator already copies
-- s.address onto each booking (src/lib/automations.ts:4024) -- it now copies
-- the property too.

alter table public.booking_series
  add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_series_property_org_fk'
      and conrelid = 'public.booking_series'::regclass
  ) then
    alter table public.booking_series
      add constraint booking_series_property_org_fk
        foreign key (property_id, organization_id)
        references public.client_properties (id, organization_id);
  end if;
end $$;

create index if not exists booking_series_property_idx
  on public.booking_series (property_id)
  where property_id is not null;


-- -- 4. Backfill: every client keeps working, unchanged -------------------------
-- Any client that already has an address gets exactly one property built from
-- it, so the picker is never empty and nobody has to re-enter what is already
-- on file. Deliberately conservative:
--
--   * ONE property per client, from clients.address only. The distinct
--     bookings.address values are NOT promoted into properties -- at Svit
--     those are mostly typos of each other ("107A Ane NW"), and importing
--     them would enshrine the exact mess this table removes. Real second
--     properties get added by hand, which is a handful of rows and a human
--     who knows which is which.
--   * Existing bookings are NOT repointed. Their address snapshot stays
--     authoritative; see the header.
--
-- Idempotent via the not-exists guard, so re-running changes nothing.

insert into public.client_properties (organization_id, client_id, label, address)
select c.organization_id,
       c.id,
       'Main address',
       c.address
from public.clients c
where c.address is not null
  and length(btrim(c.address)) > 0
  and c.archived_at is null
  and not exists (
    select 1 from public.client_properties p where p.client_id = c.id
  );


-- -- 5. RLS ---------------------------------------------------------------------
-- Mirrors public.clients exactly (20260407230757_domain_rls.sql +
-- 20260411030001_manager_rls.sql): everyone in the org reads, owner/admin/
-- manager writes. Cleaners MUST be able to read -- access_notes is useless if
-- the person standing at the door cannot see it.
--
-- Note what this does NOT do: there is no policy granting a client portal user
-- access to their own properties. Portal reads run through the service role
-- after requireClient(), so adding one here would widen the surface without
-- anyone choosing to. If properties are ever shown in the portal, decide then
-- whether access_notes goes with them -- a client seeing their own door code
-- is fine; that column reaching any other reader is not.

alter table public.client_properties enable row level security;

drop policy if exists "members read client properties" on public.client_properties;
create policy "members read client properties"
on public.client_properties for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins write client properties" on public.client_properties;
create policy "admins write client properties"
on public.client_properties for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update client properties" on public.client_properties;
create policy "admins update client properties"
on public.client_properties for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete client properties" on public.client_properties;
create policy "admins delete client properties"
on public.client_properties for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));


COMMENT ON TABLE public.client_properties IS
  'A physical place a client has cleaned. One client may have many. Exists because clients.address assumed client = address, which fails for anyone owning more than one building (Airbnb hosts, landlords, property managers) and quietly corrupts data even for single-address clients, since bookings.address is free text retyped per booking.';
COMMENT ON COLUMN public.client_properties.access_notes IS
  'How to get in: lockbox/gate codes, key location, parking. SENSITIVE -- readable by every member of the org because cleaners need it on site. Never expose through a client-portal or public-token query without an explicit decision.';
COMMENT ON COLUMN public.bookings.property_id IS
  'Which client property this job is at. Additive: bookings.address remains the authoritative historical snapshot of where a job actually happened and still wins for display, so past bookings and the invoices drawn from them are never rewritten.';

notify pgrst, 'reload schema';
