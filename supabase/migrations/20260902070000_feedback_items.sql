-- The feedback board — the surface that replaces voice messages.
--
-- Brian and Svitlana currently trade bugs, questions, and answers as voice
-- memos. Nothing is searchable, nothing has a status, and half the meeting
-- lists (#78-#86, Aug 17, Aug 30) only ever existed in a session transcript.
-- Worse, items regularly stall in BOTH directions: several Aug-17 items were
-- blocked on Brian's questions going back the other way, with no place to
-- park the question where she would see it.
--
-- So this is deliberately not a bug tracker. It is a two-way thread with one
-- job: make it obvious whose turn it is. That is what needs_answer is for —
-- the only status meaning "Sollos is blocked on YOU", and the board sorts it
-- to the top.
--
-- Context is captured, never typed. A voice memo saying "the thing on the
-- schedule page is broken" costs a round trip to answer "which page, which
-- build, which phone". page_context, app_version, and user_agent are filled
-- in by the server so nobody has to remember them.
--
-- Access shape: owner/admin/manager get the whole board (Brian sees Svit's
-- board as an admin member of her org — there is no platform-admin surface,
-- by design). Employees can file and follow their OWN items only: a cleaner
-- hitting a bug in the field is the single hardest report to reproduce, and
-- it is worth catching, but the board is not a company-wide comment section.

-- -----------------------------------------------------------------------------
-- Helper: which membership rows belong to the caller.
--
-- Mirrors current_user_org_ids(). Needed because the employee policies below
-- key on created_by (a membership id), and reading memberships directly from
-- a policy re-enters memberships' own RLS — the recursion that
-- 20260613000000 had to unpick for chat.
-- -----------------------------------------------------------------------------
create or replace function public.current_user_membership_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.memberships
  where profile_id = auth.uid()
    and status = 'active';
$$;

revoke all on function public.current_user_membership_ids() from public;
grant execute on function public.current_user_membership_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Items
-- -----------------------------------------------------------------------------
create table if not exists public.feedback_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  kind             text not null default 'bug'
                   check (kind in ('bug', 'idea', 'question')),
  title            text not null check (length(title) between 1 and 200),
  body             text,
  status           text not null default 'open'
                   check (status in ('open', 'needs_answer', 'in_progress', 'shipped', 'closed')),
  -- Captured by the server at file time, never typed by the reporter.
  page_context     text,
  app_version      text,
  user_agent       text,
  created_by       uuid references public.memberships(id) on delete set null,
  -- Bumped on every reply so the board sorts by real conversation, not by
  -- when something was first filed. A three-week-old item that got an answer
  -- this morning belongs at the top.
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists feedback_items_board_idx
  on public.feedback_items (organization_id, status, last_activity_at desc);

create index if not exists feedback_items_mine_idx
  on public.feedback_items (created_by, last_activity_at desc);

alter table public.feedback_items enable row level security;

drop policy if exists "managers_all_feedback_items" on public.feedback_items;
create policy "managers_all_feedback_items"
  on public.feedback_items for all
  to authenticated
  using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- Employees: read your own, file new ones. No update, no delete — an employee
-- cannot silently close the bug they reported, and nobody can rewrite history
-- on a thread someone else is answering.
drop policy if exists "employees_read_own_feedback_items" on public.feedback_items;
create policy "employees_read_own_feedback_items"
  on public.feedback_items for select
  to authenticated
  using (created_by in (select public.current_user_membership_ids()));

drop policy if exists "employees_file_own_feedback_items" on public.feedback_items;
create policy "employees_file_own_feedback_items"
  on public.feedback_items for insert
  to authenticated
  with check (
    organization_id in (select public.current_user_org_ids())
    and created_by in (select public.current_user_membership_ids())
  );

drop trigger if exists feedback_items_set_updated_at on public.feedback_items;
create trigger feedback_items_set_updated_at
before update on public.feedback_items
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Replies
--
-- organization_id is denormalized on purpose: the manager policy is then a
-- plain role check that never has to reach into feedback_items, which keeps
-- the common path off a subquery.
-- -----------------------------------------------------------------------------
create table if not exists public.feedback_replies (
  id               uuid primary key default gen_random_uuid(),
  feedback_item_id uuid not null references public.feedback_items(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  body             text not null check (length(body) between 1 and 4000),
  created_by       uuid references public.memberships(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists feedback_replies_item_idx
  on public.feedback_replies (feedback_item_id, created_at);

alter table public.feedback_replies enable row level security;

drop policy if exists "managers_all_feedback_replies" on public.feedback_replies;
create policy "managers_all_feedback_replies"
  on public.feedback_replies for all
  to authenticated
  using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- Employees can follow and answer on their own threads. The feedback_items
-- subquery runs under that table's OWN policies, so for an employee it
-- resolves to exactly the items they filed — no extra ownership check needed
-- here, and no recursion (different table).
drop policy if exists "employees_read_own_feedback_replies" on public.feedback_replies;
create policy "employees_read_own_feedback_replies"
  on public.feedback_replies for select
  to authenticated
  using (
    feedback_item_id in (
      select id from public.feedback_items
      where created_by in (select public.current_user_membership_ids())
    )
  );

drop policy if exists "employees_write_own_feedback_replies" on public.feedback_replies;
create policy "employees_write_own_feedback_replies"
  on public.feedback_replies for insert
  to authenticated
  with check (
    organization_id in (select public.current_user_org_ids())
    and created_by in (select public.current_user_membership_ids())
    and feedback_item_id in (
      select id from public.feedback_items
      where created_by in (select public.current_user_membership_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- Every reply bumps the thread, and answers the question it was waiting on.
--
-- Has to be a definer trigger rather than an update from the server action:
-- employees have no update policy on feedback_items (deliberately — they must
-- not be able to close their own bug), so an action-side write is silently a
-- no-op for exactly the people whose replies are easiest to miss. Their answer
-- would land at the bottom of a board sorted by an activity time that never
-- moved, under a status still reading "needs your answer".
--
-- The needs_answer → open flip is the board's one piece of automation, and it
-- belongs here rather than in the action for the same reason: it has to hold
-- for every reply from anyone, or the status stops meaning what it says. A
-- manager who replies and still needs an answer picks needs_answer in the
-- form, and the action writes it back immediately after this trigger runs.
-- -----------------------------------------------------------------------------
create or replace function public.feedback_bump_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.feedback_items
     set last_activity_at = now(),
         status = case when status = 'needs_answer' then 'open' else status end
   where id = new.feedback_item_id;
  return new;
end;
$$;

drop trigger if exists feedback_replies_bump_activity on public.feedback_replies;
create trigger feedback_replies_bump_activity
after insert on public.feedback_replies
for each row execute function public.feedback_bump_activity();

notify pgrst, 'reload schema';
