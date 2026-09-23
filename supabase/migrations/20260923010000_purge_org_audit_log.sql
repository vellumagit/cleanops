-- Tenant erasure has to be able to reach audit_log.
--
-- audit_log is append-only by trigger (20260408040000_invoicing_integrations):
-- a service-role code path could otherwise rewrite history, so UPDATE and
-- DELETE both raise. That guard is right for every normal path and wrong for
-- exactly one — purging a deleted tenant.
--
-- audit_log.after holds the row payload, and for a client create that payload
-- is {name, email}. A workspace's audit trail is therefore a second copy of
-- its customers' personal data. On 2026-09-11 a spam signup created 35,423
-- clients from harvested addresses; the 67,664 audit rows recording it hold
-- those same people's addresses. purgeOrgData could not touch them, and
-- because it never read the delete error, it reported success anyway.
--
-- So: keep the trigger, add one door. The reject function now yields while
-- app.audit_purge is 'on', and only these SECURITY DEFINER functions turn it
-- on — set LOCAL, so it dies with the transaction, and scoped to a single
-- organization id. Every other caller, service role included, still raises.

create or replace function public.audit_log_reject_mutations()
returns trigger
language plpgsql
as $$
begin
  -- The one sanctioned exception: a tenant purge, which sets this flag for
  -- its own transaction only and clears it on the way out.
  if coalesce(current_setting('app.audit_purge', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception 'audit_log is append-only (attempted %)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Delete one org's audit rows, at most p_limit per call.
--
-- Batched by design: PostgREST runs an RPC as a single statement, so looping
-- INSIDE the function would still be one statement against statement_timeout
-- — which is exactly how the 35,423-row `clients` delete died. The caller
-- loops instead, one small statement at a time.
create or replace function public.purge_org_audit_log(
  p_org uuid,
  p_limit integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  if p_org is null then
    raise exception 'purge_org_audit_log requires an organization id';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20000 then
    raise exception 'p_limit must be between 1 and 20000';
  end if;

  perform set_config('app.audit_purge', 'on', true);

  delete from public.audit_log
   where id in (
     select id from public.audit_log
      where organization_id = p_org
      limit p_limit
   );
  get diagnostics removed = row_count;

  perform set_config('app.audit_purge', 'off', true);
  return removed;
end;
$$;

-- Audit rows in OTHER orgs can name this org's memberships as the actor.
-- Deleting those memberships fires `audit_log.actor_id ... on delete set null`
-- — an UPDATE on audit_log, which the trigger rejects. That is why purging a
-- workspace failed at `memberships` with "attempted UPDATE" even after its own
-- audit rows were gone. Clear those references first, while the door is open.
create or replace function public.purge_org_audit_actors(p_org uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cleared bigint;
begin
  if p_org is null then
    raise exception 'purge_org_audit_actors requires an organization id';
  end if;

  perform set_config('app.audit_purge', 'on', true);

  update public.audit_log a
     set actor_id = null
   where a.actor_id in (
     select m.id from public.memberships m where m.organization_id = p_org
   );
  get diagnostics cleared = row_count;

  perform set_config('app.audit_purge', 'off', true);
  return cleared;
end;
$$;

revoke all on function public.purge_org_audit_log(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.purge_org_audit_actors(uuid)
  from public, anon, authenticated;
grant execute on function public.purge_org_audit_log(uuid, integer) to service_role;
grant execute on function public.purge_org_audit_actors(uuid) to service_role;

notify pgrst, 'reload schema';
