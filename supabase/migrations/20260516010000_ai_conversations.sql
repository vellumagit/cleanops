-- AI assistant conversations
-- Stores every chat session so we can review what users find confusing or buggy.

create table ai_conversations (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  membership_id  uuid references memberships(id) on delete set null,
  messages       jsonb not null default '[]',
  page_context   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index ai_conversations_org_idx on ai_conversations(organization_id, created_at desc);

alter table ai_conversations enable row level security;

-- Only the owning member can read their own conversations
create policy "members read own ai conversations"
  on ai_conversations for select
  using (
    exists (
      select 1 from memberships m
      where m.id = membership_id
        and m.profile_id = auth.uid()
    )
  );

-- Writes go through the admin client (server-side only)
create policy "service role manages ai conversations"
  on ai_conversations for all
  using (true)
  with check (true);
