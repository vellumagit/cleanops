-- =============================================================================
-- CleanOps Phase 8 — Chat infrastructure
-- =============================================================================
-- 1. Ensures every organization has a single "general" group chat thread,
--    and that every active membership is automatically a member of it.
-- 2. Backfills the #general thread + memberships for existing orgs.
-- 3. Adds chat_messages to the supabase_realtime publication so the browser
--    can subscribe to inserts via postgres_changes.
--
-- DM threads are created on-demand by a server action using the admin client
-- (the per-row insert policy on chat_thread_members is admin-only by design).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ensure_general_thread — create the org's #general thread if missing
-- -----------------------------------------------------------------------------

create or replace function public.ensure_general_thread(target_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  select id into v_thread_id
  from public.chat_threads
  where organization_id = target_org
    and kind = 'group'
    and name = 'general'
  limit 1;

  if v_thread_id is null then
    insert into public.chat_threads (organization_id, kind, name)
    values (target_org, 'group', 'general')
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$$;

revoke all on function public.ensure_general_thread(uuid) from public;

-- -----------------------------------------------------------------------------
-- handle_new_membership — auto-add new members to #general
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  v_thread_id := public.ensure_general_thread(new.organization_id);

  insert into public.chat_thread_members (organization_id, thread_id, membership_id)
  values (new.organization_id, v_thread_id, new.id)
  on conflict (thread_id, membership_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_membership_created on public.memberships;
create trigger on_membership_created
after insert on public.memberships
for each row execute function public.handle_new_membership();

-- -----------------------------------------------------------------------------
-- Backfill: ensure every existing org + active membership is in #general
-- -----------------------------------------------------------------------------

do $$
declare
  org record;
  v_thread_id uuid;
begin
  for org in select id from public.organizations loop
    v_thread_id := public.ensure_general_thread(org.id);
    insert into public.chat_thread_members (organization_id, thread_id, membership_id)
    select m.organization_id, v_thread_id, m.id
    from public.memberships m
    where m.organization_id = org.id
      and m.status = 'active'
    on conflict (thread_id, membership_id) do nothing;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Realtime — make sure chat_messages broadcasts inserts
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Add chat_messages if it isn't already in the publication.
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.chat_messages';
    end if;
  end if;
end $$;

comment on function public.ensure_general_thread(uuid) is
  'Returns the id of the org #general chat thread, creating it if it does not yet exist.';
comment on function public.handle_new_membership() is
  'Trigger handler that adds a freshly-created membership to the org #general chat.';
