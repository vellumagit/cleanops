-- Interview answers, attached to the applicant.
--
-- The hiring library gives the questionnaire (hiring_docs, a printed
-- script to read down); this gives the answers somewhere to live. Same
-- immutability rule as booking checklists (20260422040000): the
-- questions are COPIED into the interview row at start time, so editing
-- the library questionnaire later never rewrites or orphans a recorded
-- interview. `answers` is a text array parallel to `questions`;
-- hiring_doc_id is provenance only (SET NULL if the doc is deleted).
--
-- Multiple interviews per applicant are allowed on purpose — a first
-- phone screen and an in-person follow-up are different conversations.

create table if not exists public.applicant_interviews (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id)  on delete cascade,
  applicant_id    uuid not null references public.job_applicants(id) on delete cascade,
  hiring_doc_id   uuid references public.hiring_docs(id)             on delete set null,
  title           text not null,
  -- Snapshot of hiring_docs.items at start time: ordered string array.
  questions       jsonb not null default '[]'::jsonb,
  -- Parallel string array; '' = not answered yet.
  answers         jsonb not null default '[]'::jsonb,
  notes           text,
  conducted_by    uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists applicant_interviews_applicant_idx
  on public.applicant_interviews (applicant_id);
create index if not exists applicant_interviews_org_idx
  on public.applicant_interviews (organization_id);

alter table public.applicant_interviews enable row level security;

-- Same visibility as job_applicants: owner/admin only. Writes go through
-- service-role server actions that re-check the role.
create policy "org_admins_read_applicant_interviews"
  on public.applicant_interviews for select
  using (organization_id in (
    select organization_id from public.memberships
    where profile_id = auth.uid() and status = 'active'
      and role in ('owner', 'admin')
  ));

drop trigger if exists applicant_interviews_set_updated_at on public.applicant_interviews;
create trigger applicant_interviews_set_updated_at
before update on public.applicant_interviews
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
