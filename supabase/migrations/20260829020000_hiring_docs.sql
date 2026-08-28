-- The hiring library: interview questionnaires + hiring procedures.
--
-- Brian: "inside of hiring, I should be able to create job interview
-- questionnaires ... hiring procedures, this kind of thing." Deliberately
-- SEPARATE from training_modules: training is what a NEW employee works
-- through after the yes; hiring docs are what the OWNER works from before
-- it. One table, a kind column, items as an ordered jsonb list (questions
-- for questionnaires, steps for procedures) — same storage shape either
-- way, and `kind` is text so future kinds (rejection templates, offer
-- letters) need no migration.

create table if not exists public.hiring_docs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            text not null check (kind in ('questionnaire', 'procedure')),
  title           text not null check (length(title) between 1 and 160),
  -- Ordered strings: questions or steps. Edited as one-per-line text.
  items           jsonb not null default '[]'::jsonb,
  -- Optional freeform intro / notes shown above the items.
  notes           text,
  is_active       boolean not null default true,
  created_by      uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists hiring_docs_org_idx
  on public.hiring_docs (organization_id, kind);

alter table public.hiring_docs enable row level security;

create policy "org_members_read_hiring_docs"
  on public.hiring_docs for select
  using (organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  ));

create policy "org_admins_write_hiring_docs"
  on public.hiring_docs for all
  using (organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin')
  ))
  with check (organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin')
  ));

drop trigger if exists hiring_docs_set_updated_at on public.hiring_docs;
create trigger hiring_docs_set_updated_at
before update on public.hiring_docs
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
