-- ============================================================
-- Employee documents — files attached to a team member's file
-- ============================================================

create table if not exists public.membership_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id)    on delete cascade,
  category        text not null default 'other',
  label           text not null,
  file_name       text not null,
  file_path       text not null,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists membership_documents_membership_idx
  on public.membership_documents (membership_id);
create index if not exists membership_documents_org_idx
  on public.membership_documents (organization_id);

alter table public.membership_documents enable row level security;

-- Owners/admins of the org may read. All writes happen through service-role
-- server actions (which enforce the same check), so there is intentionally
-- no INSERT/UPDATE/DELETE policy for regular users.
drop policy if exists membership_documents_select on public.membership_documents;
create policy membership_documents_select
  on public.membership_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = membership_documents.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.status = 'active'
    )
  );

-- ============================================================
-- Private storage bucket for the files (all access via service role)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('employee-documents', 'employee-documents', false)
on conflict (id) do nothing;
