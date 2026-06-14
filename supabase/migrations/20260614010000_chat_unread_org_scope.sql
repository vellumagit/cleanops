-- Scope chat unread to a single org.
--
-- chat_unread_total()/chat_unread_threads() keyed only off auth.uid(), so a
-- user who belongs to more than one org had their nav badge summed across
-- ALL of them — disagreeing with the per-thread badges (which are scoped to
-- the active membership) and bleeding the existence of unread activity from
-- an org they aren't currently acting in. Add an optional org filter and
-- have the app pass the active org.

drop function if exists public.chat_unread_total();
drop function if exists public.chat_unread_threads();

create function public.chat_unread_threads(p_org_id uuid default null)
returns table(thread_id uuid, unread bigint, last_message_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select tm.thread_id,
         count(msg.id) filter (
           where msg.created_at > coalesce(tm.last_read_at, '-infinity'::timestamptz)
             and msg.sender_id is distinct from tm.membership_id
         ) as unread,
         max(msg.created_at) as last_message_at
  from public.chat_thread_members tm
  join public.memberships me on me.id = tm.membership_id
  left join public.chat_messages msg on msg.thread_id = tm.thread_id
  where me.profile_id = auth.uid()
    and me.status = 'active'
    and (p_org_id is null or tm.organization_id = p_org_id)
  group by tm.thread_id;
$$;

create function public.chat_unread_total(p_org_id uuid default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(unread), 0)::bigint
  from public.chat_unread_threads(p_org_id);
$$;

revoke all on function public.chat_unread_threads(uuid) from public;
revoke all on function public.chat_unread_total(uuid) from public;
grant execute on function public.chat_unread_threads(uuid) to authenticated;
grant execute on function public.chat_unread_total(uuid) to authenticated;
