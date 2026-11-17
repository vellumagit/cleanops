-- ROLLBACK for 20261116070000_catch_up_production.sql. Use only if the catch-up
-- stops an everyday action and you need production back as it was on 16 Nov
-- while it's fixed properly. It puts back the rules exactly as
-- docs/production-policy-check.sql read them, which REOPENS the hole: any
-- member can then update any booking, estimate or invoice in their company.
-- It removes the guard triggers; the functions and reports can stay.

begin;
set local search_path = public, extensions;

drop trigger if exists time_entries_employee_insert_guard on public.time_entries;
drop trigger if exists memberships_owner_guard on public.memberships;
drop trigger if exists invitations_owner_guard on public.invitations;
drop trigger if exists bookings_assignee_column_guard on public.bookings;
drop trigger if exists bookings_client_org_guard on public.bookings;
drop trigger if exists invoices_client_org_guard on public.invoices;
drop trigger if exists estimates_client_org_guard on public.estimates;
drop trigger if exists contracts_client_org_guard on public.contracts;

drop policy if exists "Members can update their org bookings" on public.bookings;
create policy "Members can update their org bookings" on public.bookings for update to public
  using (organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1))
  with check ((organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1)) and (archived_at is null));

drop policy if exists "Members can update their org estimates" on public.estimates;
create policy "Members can update their org estimates" on public.estimates for update to public
  using (organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1))
  with check ((organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1)) and (archived_at is null));

drop policy if exists "Members can update their org invoices" on public.invoices;
create policy "Members can update their org invoices" on public.invoices for update to public
  using (organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1))
  with check ((organization_id = (select memberships.organization_id from memberships
    where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1)) and (archived_at is null));

drop policy if exists "employees can insert own pto requests" on public.pto_requests;
create policy "employees can insert own pto requests" on public.pto_requests for insert to public
  with check (employee_id in (select m.id from memberships m
    where m.profile_id = auth.uid() and m.status = 'active'::membership_status));

commit;
