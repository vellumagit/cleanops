-- Shift change requests: persistent record of a cleaner asking to be taken
-- off a standing recurring client ("cancel upcoming"). Surfaced in the
-- Scheduling "Needs coverage" panel so owners can act and mark it handled,
-- rather than relying on a transient notification.

create table if not exists public.shift_change_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  booking_id      uuid references public.bookings(id) on delete set null,
  series_id       uuid references public.booking_series(id) on delete set null,
  kind            text not null default 'series_stop'
                    check (kind in ('series_stop')),
  reason          text,
  status          text not null default 'open'
                    check (status in ('open', 'resolved')),
  resolved_by     uuid references public.memberships(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists shift_change_requests_org_status_idx
  on public.shift_change_requests (organization_id, status);

alter table public.shift_change_requests enable row level security;

-- Managers/admins/owners read + resolve requests for their org.
drop policy if exists "managers read shift change requests" on public.shift_change_requests;
create policy "managers read shift change requests"
on public.shift_change_requests for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "managers update shift change requests" on public.shift_change_requests;
create policy "managers update shift change requests"
on public.shift_change_requests for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- A member can file a request for their own org (the field action also uses
-- the service role, so this is mostly defense-in-depth).
drop policy if exists "members insert own shift change requests" on public.shift_change_requests;
create policy "members insert own shift change requests"
on public.shift_change_requests for insert
to authenticated
with check (
  organization_id in (select public.current_user_org_ids())
  and membership_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);
