-- Chat read/unread state + helpers.
--
-- Adds a per-member "last_read_at" watermark on chat_thread_members and
-- three SECURITY DEFINER helpers the app calls:
--   chat_unread_threads()  -> per-thread unread count for the current user
--   chat_unread_total()    -> single number for the nav badge
--   chat_mark_thread_read(thread) -> advance the watermark to now()
-- They run as the table owner so they don't depend on chat RLS, and they
-- key off auth.uid() so they only ever see the caller's own rows.

alter table public.chat_thread_members
  add column if not exists last_read_at timestamptz;

-- Backfill existing rows so the feature launches "caught up" rather than
-- showing a huge retroactive unread count on day one.
update public.chat_thread_members
set last_read_at = now()
where last_read_at is null;

-- New thread members start caught up.
alter table public.chat_thread_members
  alter column last_read_at set default now();

-- Per-thread unread for the current user: messages after their watermark
-- that they didn't send themselves, plus the latest activity timestamp
-- (used to sort threads most-recent-first).
create or replace function public.chat_unread_threads()
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
  group by tm.thread_id;
$$;

create or replace function public.chat_unread_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(unread), 0)::bigint from public.chat_unread_threads();
$$;

create or replace function public.chat_mark_thread_read(p_thread_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.chat_thread_members tm
  set last_read_at = now()
  from public.memberships me
  where tm.membership_id = me.id
    and me.profile_id = auth.uid()
    and me.status = 'active'
    and tm.thread_id = p_thread_id;
$$;

revoke all on function public.chat_unread_threads() from public;
revoke all on function public.chat_unread_total() from public;
revoke all on function public.chat_mark_thread_read(uuid) from public;
grant execute on function public.chat_unread_threads() to authenticated;
grant execute on function public.chat_unread_total() to authenticated;
grant execute on function public.chat_mark_thread_read(uuid) to authenticated;
