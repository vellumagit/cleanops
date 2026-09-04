-- ============================================================
-- Client emails — messages the office wrote to a client by hand
-- ============================================================
--
-- Until now every email Sollos sent was a template hung off an action
-- (invoice sent, estimate sent, contract to sign, reminders). There was
-- no way to write to a client and attach the paperwork on their record.
-- Brian, 2026-09-03: "build an Email client button. if they're setup
-- with email in sollos3, they can send an email directly and attach
-- docs." This table is the sent folder for those: who wrote what to
-- whom, with which attachments, and whether Resend took it.
--
-- Modeled on client_documents (20260831): metadata row, owner/admin/
-- manager read, all writes through service-role server actions. The
-- action pins the recipient to the client's address on record, so this
-- can never be used to mail a client's documents somewhere else.

create table if not exists public.client_emails (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id)       on delete cascade,
  sent_by         uuid references public.memberships(id) on delete set null,
  to_email        text not null,
  subject         text not null,
  body            text not null,
  -- [{ name, size_bytes, document_id | null }] — document_id points at
  -- client_documents when the attachment came from the record.
  attachments     jsonb not null default '[]'::jsonb,
  status          text not null default 'sent'
                  check (status in ('sent', 'failed')),
  error           text,
  provider_id     text,
  created_at      timestamptz not null default now()
);

create index if not exists client_emails_client_idx
  on public.client_emails (client_id, created_at desc);
create index if not exists client_emails_org_idx
  on public.client_emails (organization_id);

alter table public.client_emails enable row level security;

-- Owner/admin/manager may read. No INSERT/UPDATE/DELETE policy on
-- purpose: the send action writes with the service role after doing the
-- same role check, so the database never accepts a hand-written row.
drop policy if exists client_emails_select on public.client_emails;
create policy client_emails_select
  on public.client_emails
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = client_emails.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin', 'manager')
        and m.status = 'active'
    )
  );

notify pgrst, 'reload schema';
