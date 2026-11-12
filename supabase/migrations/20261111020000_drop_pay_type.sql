-- memberships.pay_type, dropped (decided 2026-11-11).
--
-- Added in 20260413040000 as hourly | flat | percent. Nothing in the app ever
-- set it: there was no field for it, Timesheets hard-coded "hourly", and every
-- pay path multiplies the hourly rate by hours. On 2026-11-11 all 59
-- memberships in production were 'hourly'. The code no longer mentions it.
--
-- Safe to run before or after the push: the code live today never reads or
-- writes this column. Each step leaves the database consistent if a later
-- one stops, so a failure part-way is harmless.

-- 1. The owner guard compared pay_type on self-edits. Same function as in
--    20260913030000 with only that comparison removed. It has to go first:
--    once the column is gone, the old body fails any admin editing their own
--    membership (even their name) with "column does not exist".
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
       or new.pay_rate_cents is distinct from old.pay_rate_cents then
      raise exception 'you cannot change your own role or pay' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- 2. Stop, rather than drop, if anything says otherwise: someone on a
--    non-hourly basis, or another database function that still names the
--    column (it would break at runtime, not at the drop).
do $$
declare
  fn text;
begin
  if exists (select 1 from public.memberships where pay_type <> 'hourly') then
    raise exception 'A membership has a pay_type other than hourly; look at it before dropping the column.';
  end if;
  select string_agg(p.proname, ', ') into fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ilike '%pay_type%';
  if fn is not null then
    raise exception 'These functions still mention pay_type: %', fn;
  end if;
end $$;

-- 3. The column, and its check constraint with it. A view that used it would
--    make this fail instead of dropping silently (no CASCADE).
alter table public.memberships
  drop column if exists pay_type;
