-- Per-member Google Calendar connections
--
-- Extends integration_connections so any member (not just admins) can
-- connect their personal Google Calendar. Events for their assigned
-- bookings are pushed to their calendar and tracked in a new mapping
-- table. Org-level connections are unchanged (membership_id IS NULL).

-- -------------------------------------------------------------------------
-- 1. Extend integration_connections
-- -------------------------------------------------------------------------

alter table integration_connections
  add column if not exists membership_id uuid references memberships(id) on delete cascade;

-- The existing unique index covers (organization_id, provider) WHERE
-- status='active'. That was safe when only one row per org existed, but
-- now an org can have one org-level row (membership_id IS NULL) PLUS many
-- member-level rows. We need separate indexes for each case.

drop index if exists integration_connections_active_uidx;

-- Org-level: one active connection per (org, provider)
create unique index if not exists integration_connections_org_active_uidx
  on integration_connections (organization_id, provider)
  where status = 'active' and membership_id is null;

-- Member-level: one active connection per (member, provider)
create unique index if not exists integration_connections_member_active_uidx
  on integration_connections (membership_id, provider)
  where status = 'active' and membership_id is not null;

-- Speed up member-level lookups
create index if not exists integration_connections_membership_idx
  on integration_connections (membership_id)
  where membership_id is not null;

-- Allow members to read their own connection row (e.g. to show
-- connected/disconnected status on the Profile page).
-- All writes still go through the admin client (service role bypasses RLS).
drop policy if exists "members read own integration_connections" on integration_connections;
create policy "members read own integration_connections"
  on integration_connections for select
  to authenticated
  using (
    membership_id is not null
    and exists (
      select 1 from memberships m
      where m.id = membership_id
        and m.profile_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------------
-- 2. New table: booking_member_calendar_events
--
-- Maps (booking, member) → google_calendar_event_id for personal
-- calendars. The org-level mapping continues to live in
-- bookings.google_calendar_event_id.
-- -------------------------------------------------------------------------

create table if not exists booking_member_calendar_events (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references bookings(id) on delete cascade,
  membership_id            uuid not null references memberships(id) on delete cascade,
  google_calendar_event_id text not null,
  created_at               timestamptz not null default now(),
  unique (booking_id, membership_id)
);

create index if not exists booking_member_cal_booking_idx
  on booking_member_calendar_events (booking_id);

create index if not exists booking_member_cal_membership_idx
  on booking_member_calendar_events (membership_id);

alter table booking_member_calendar_events enable row level security;

-- Members can read their own event-ID rows (useful if the field app
-- ever needs to deep-link into the calendar event).
drop policy if exists "members read own booking_member_calendar_events" on booking_member_calendar_events;
create policy "members read own booking_member_calendar_events"
  on booking_member_calendar_events for select
  using (
    exists (
      select 1 from memberships m
      where m.id = membership_id
        and m.profile_id = auth.uid()
    )
  );

-- All writes (insert / update / delete) go through the admin client.
drop policy if exists "service role manages booking_member_calendar_events" on booking_member_calendar_events;
create policy "service role manages booking_member_calendar_events"
  on booking_member_calendar_events for all
  using (true)
  with check (true);
