-- ============================================================
-- The database stops trusting the app to be the only writer
-- ============================================================
--
-- September audit, Tier 0. Every guard below already existed in a server
-- action; none existed in the database, and the browser client ships with
-- the anon key, so any employee could skip the action and write the row
-- directly. These triggers make the database say no on its own.
--
-- Two exemptions run through all of them: the service role (server-side
-- code that has already checked) and, where noted, managers. Everything
-- else is judged by the JWT's own memberships via current_user_has_role().

-- "Trusted writer": the service role (server code that has already checked)
-- or no PostgREST request at all (the SQL editor, migrations, maintenance).
-- The anon and authenticated roles always carry claims, so they never match.
create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

-- ── S1: a cleaner's clock-in is stamped by the server, never by the row ──
-- Non-managers may INSERT a time entry (that IS clocking in), but the
-- database decides when it started (now), that it is still open, and what
-- rate and engagement it carries (the membership's), and that no run has
-- claimed it. A closed, back-dated, self-priced row is refused by being
-- rewritten into an honest open one — which is what the app sends anyway.
create or replace function public.time_entries_employee_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  if public.is_service_role() then
    return new;
  end if;
  if public.current_user_has_role(new.organization_id, array['owner','admin','manager']::public.membership_role[]) then
    return new;
  end if;
  select pay_rate_cents, engagement into m
  from public.memberships
  where id = new.employee_id and organization_id = new.organization_id;
  if not found then
    raise exception 'time entry: employee % is not in organization %', new.employee_id, new.organization_id
      using errcode = '42501';
  end if;
  new.clock_in_at := now();
  new.clock_out_at := null;
  new.payroll_run_id := null;
  new.subcontractor_run_id := null;
  new.needs_review := coalesce(new.needs_review, false);
  new.pay_rate_cents_snapshot := m.pay_rate_cents;
  new.engagement_snapshot := coalesce(m.engagement, 'employee');
  return new;
end;
$$;

drop trigger if exists time_entries_employee_insert_guard on public.time_entries;
create trigger time_entries_employee_insert_guard
  before insert on public.time_entries
  for each row execute function public.time_entries_employee_insert_guard();

-- ── S2: employees do not insert their own PTO ──
-- The field app has no PTO submit path; this policy had no legitimate user
-- and let a cleaner insert status='approved', hours=9999.
drop policy if exists "employees can insert own pto requests" on public.pto_requests;

-- ── S3: the owner role is an owner's to give, take, or lose ──
create or replace function public.memberships_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_owner boolean;
  is_self boolean;
begin
  if public.is_service_role() then
    return new;
  end if;
  caller_is_owner := public.current_user_has_role(new.organization_id, array['owner']::public.membership_role[]);
  if tg_op = 'INSERT' then
    if new.role = 'owner' and not caller_is_owner then
      raise exception 'only an owner can add an owner' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE
  if (old.role = 'owner' or new.role = 'owner') and not caller_is_owner then
    -- Touching an owner row at all (role, status, pay) or making someone an owner.
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.pay_rate_cents is distinct from old.pay_rate_cents then
      raise exception 'only an owner can change an owner''s role, status or pay' using errcode = '42501';
    end if;
  end if;
  is_self := exists (
    select 1 from public.memberships me
    where me.id = new.id and me.profile_id = auth.uid()
  );
  if is_self and not caller_is_owner then
    if new.role is distinct from old.role
       or new.pay_rate_cents is distinct from old.pay_rate_cents
       or new.pay_type is distinct from old.pay_type then
      raise exception 'you cannot change your own role or pay' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_owner_guard on public.memberships;
create trigger memberships_owner_guard
  before insert or update on public.memberships
  for each row execute function public.memberships_owner_guard();

create or replace function public.invitations_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_service_role() then
    return new;
  end if;
  if new.role = 'owner'
     and not public.current_user_has_role(new.organization_id, array['owner']::public.membership_role[]) then
    raise exception 'only an owner can invite an owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_owner_guard on public.invitations;
create trigger invitations_owner_guard
  before insert or update on public.invitations
  for each row execute function public.invitations_owner_guard();

-- ── S5: an assignee may move a booking's status, and nothing else ──
-- The assignee branch of the update policy has no column restriction, so
-- the cleaner on a job could reprice it, re-date it past the future-status
-- trigger, point it at another client, or clear its billing stamp. Now any
-- column but status/notes/updated_at changing under a non-manager is refused.
create or replace function public.bookings_assignee_column_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_j jsonb;
  after_j jsonb;
begin
  if public.is_service_role() then
    return new;
  end if;
  if public.current_user_has_role(new.organization_id, array['owner','admin','manager']::public.membership_role[]) then
    return new;
  end if;
  before_j := to_jsonb(old) - 'status' - 'notes' - 'updated_at';
  after_j  := to_jsonb(new) - 'status' - 'notes' - 'updated_at';
  if before_j is distinct from after_j then
    raise exception 'assignees may change a booking''s status and notes only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_assignee_column_guard on public.bookings;
create trigger bookings_assignee_column_guard
  before update on public.bookings
  for each row execute function public.bookings_assignee_column_guard();

-- ── S7: a booking, invoice, estimate or contract belongs to the same org as its client ──
-- Applied to every writer, service role included: this is an invariant,
-- not a permission. A row pointing at another tenant's client showed up in
-- that tenant's client portal and could email that tenant's customer.
create or replace function public.client_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  client_org uuid;
begin
  if new.client_id is null then
    return new;
  end if;
  select organization_id into client_org from public.clients where id = new.client_id;
  if client_org is null then
    raise exception 'client % does not exist', new.client_id using errcode = '23503';
  end if;
  if client_org <> new.organization_id then
    raise exception 'client % belongs to a different organization', new.client_id using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_client_org_guard on public.bookings;
create trigger bookings_client_org_guard
  before insert or update of client_id, organization_id on public.bookings
  for each row execute function public.client_org_guard();

drop trigger if exists invoices_client_org_guard on public.invoices;
create trigger invoices_client_org_guard
  before insert or update of client_id, organization_id on public.invoices
  for each row execute function public.client_org_guard();

drop trigger if exists estimates_client_org_guard on public.estimates;
create trigger estimates_client_org_guard
  before insert or update of client_id, organization_id on public.estimates
  for each row execute function public.client_org_guard();

drop trigger if exists contracts_client_org_guard on public.contracts;
create trigger contracts_client_org_guard
  before insert or update of client_id, organization_id on public.contracts
  for each row execute function public.client_org_guard();

notify pgrst, 'reload schema';
