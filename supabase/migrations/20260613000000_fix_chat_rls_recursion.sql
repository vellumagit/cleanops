-- Fix infinite recursion in chat RLS policies (Postgres error 42P17).
--
-- The "members read thread members" policy on chat_thread_members
-- subqueried chat_thread_members *itself*, so Postgres re-applied the
-- policy to that inner reference and raised
--   "infinite recursion detected in policy for relation chat_thread_members"
-- on EVERY authenticated read. Because the chat_threads and chat_messages
-- policies also subquery chat_thread_members, all three tables became
-- unreadable under RLS: thread lists came back empty (fetchChatThreads
-- silently returned []), new DMs never appeared, and message sends failed
-- their WITH CHECK. Chat was effectively dead for every non-service-role
-- caller since the April RLS migration. (The only stored messages were
-- seeded via the service role, which bypasses RLS.)
--
-- Fix: a SECURITY DEFINER helper that resolves the current user's thread
-- IDs WITHOUT triggering RLS (it runs as the table owner — same pattern as
-- the existing current_user_org_ids()). Every chat policy now calls it
-- instead of subquerying chat_thread_members inline, which removes the
-- self-reference and the recursion.

create or replace function public.current_user_thread_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.thread_id
  from public.chat_thread_members tm
  join public.memberships m on m.id = tm.membership_id
  where m.profile_id = auth.uid()
    and m.status = 'active';
$$;

revoke all on function public.current_user_thread_ids() from public;
grant execute on function public.current_user_thread_ids() to authenticated;

-- chat_threads — members read threads they belong to
drop policy if exists "members read their threads" on public.chat_threads;
create policy "members read their threads"
on public.chat_threads for select
to authenticated
using (
  organization_id in (select public.current_user_org_ids())
  and id in (select public.current_user_thread_ids())
);

-- chat_thread_members — members read the membership of threads they're in
-- (previously self-referential → the source of the recursion)
drop policy if exists "members read thread members" on public.chat_thread_members;
create policy "members read thread members"
on public.chat_thread_members for select
to authenticated
using (
  organization_id in (select public.current_user_org_ids())
  and thread_id in (select public.current_user_thread_ids())
);

-- chat_messages — members read messages in their threads
drop policy if exists "thread members read messages" on public.chat_messages;
create policy "thread members read messages"
on public.chat_messages for select
to authenticated
using (
  thread_id in (select public.current_user_thread_ids())
);

-- chat_messages — members send messages into their threads, as themselves
drop policy if exists "thread members insert messages" on public.chat_messages;
create policy "thread members insert messages"
on public.chat_messages for insert
to authenticated
with check (
  thread_id in (select public.current_user_thread_ids())
  and sender_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);
