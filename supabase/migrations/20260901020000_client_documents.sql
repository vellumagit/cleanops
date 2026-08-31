-- ============================================================
-- Client documents — files attached to a client's record
-- ============================================================
--
-- Svitlana's Aug 30 ask: somewhere to put the SIGNED copy of an invoice
-- a client returns, next to the client it belongs to. Modeled on
-- membership_documents (20260623010000): metadata row + private bucket,
-- all writes through service-role server actions. Managers are included
-- in the read policy — unlike employee files (banking, ID), a signed
-- invoice is operational paperwork the person running the day handles.

create table if not exists public.client_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id)       on delete cascade,
  category        text not null default 'other',
  label           text not null,
  file_name       text not null,
  file_path       text not null,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists client_documents_client_idx
  on public.client_documents (client_id);
create index if not exists client_documents_org_idx
  on public.client_documents (organization_id);

alter table public.client_documents enable row level security;

-- Owner/admin/manager may read. All writes happen through service-role
-- server actions (which enforce the same check), so there is intentionally
-- no INSERT/UPDATE/DELETE policy for regular users.
drop policy if exists client_documents_select on public.client_documents;
create policy client_documents_select
  on public.client_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = client_documents.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin', 'manager')
        and m.status = 'active'
    )
  );

-- ============================================================
-- Private storage bucket (all access via service role + signed URLs).
-- Size + mime limits at the bucket layer, like contract-docs: signed
-- invoices are PDFs or phone scans, nothing else belongs here.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  20971520, -- 20 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic'
  ]
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
