-- Internal tasks & reminders.
--
-- Allows owners / admins / managers to create to-do items with optional
-- due dates, reminders (push notification at remind_at), and recurrence.
-- Employees can see tasks assigned to them and mark them done.

-- ---------------------------------------------------------------------------
-- Recurrence enum
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'task_recurrence') then
    create type public.task_recurrence as enum (
      'daily', 'weekly', 'biweekly', 'monthly', 'yearly'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  created_by        uuid references public.memberships(id) on delete set null,
  assigned_to       uuid references public.memberships(id) on delete set null,
  title             text not null check (char_length(title) between 1 and 500),
  notes             text,
  due_at            timestamptz,
  remind_at         timestamptz,
  reminded_at       timestamptz,   -- set when push was sent, prevents re-fire
  recurrence        public.task_recurrence,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- updated_at trigger
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists tasks_org_due_idx
  on public.tasks (organization_id, due_at)
  where completed_at is null;

create index if not exists tasks_assigned_idx
  on public.tasks (assigned_to)
  where completed_at is null;

-- Cron uses this to find tasks that need a push sent.
create index if not exists tasks_remind_idx
  on public.tasks (remind_at)
  where reminded_at is null and completed_at is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tasks enable row level security;

-- Members see all tasks in their org (full visibility for coordination).
create policy "tasks: members can view org tasks"
  on public.tasks for select
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  );

-- Owners / admins / managers can create tasks.
create policy "tasks: managers+ can insert"
  on public.tasks for insert
  with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
  );

-- Owners / admins / managers can edit any task in the org;
-- employees can only complete (update completed_at) on their own assigned tasks.
create policy "tasks: managers+ can update any; employees can complete own"
  on public.tasks for update
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
  with check (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
    or (
      -- Employee completing their own assigned task only
      assigned_to in (
        select id from public.memberships
        where profile_id = auth.uid() and status = 'active'
      )
    )
  );

-- Only managers+ can delete.
create policy "tasks: managers+ can delete"
  on public.tasks for delete
  using (
    organization_id in (
      select organization_id from public.memberships
      where profile_id = auth.uid()
        and status = 'active'
        and role in ('owner', 'admin', 'manager')
    )
  );
