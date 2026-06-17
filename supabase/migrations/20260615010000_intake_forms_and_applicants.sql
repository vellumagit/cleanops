-- Generic inbound intake: external forms POST to /api/intake/<token>. Each
-- form carries a `type` that routes the submission to the right table. The
-- full raw payload is always kept so no form field is ever lost and new
-- event types can be added without re-plumbing. First target: job applicants.

create table if not exists public.intake_forms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  type            text not null default 'job_application',
  token           text not null unique,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists intake_forms_org_idx on public.intake_forms (organization_id);

create table if not exists public.job_applicants (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intake_form_id  uuid references public.intake_forms(id) on delete set null,
  name            text,
  email           text,
  phone           text,
  position        text,
  experience      text,
  availability    text,
  message         text,
  resume_url      text,
  raw             jsonb not null default '{}'::jsonb,  -- the full form payload
  status          text not null default 'new'
                    check (status in ('new','reviewing','interview','hired','rejected')),
  notes           text,                                 -- internal notes
  reviewed_by     uuid references public.memberships(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists job_applicants_org_created_idx
  on public.job_applicants (organization_id, created_at desc);
create index if not exists job_applicants_org_status_idx
  on public.job_applicants (organization_id, status);

drop trigger if exists intake_forms_set_updated_at on public.intake_forms;
create trigger intake_forms_set_updated_at before update on public.intake_forms
  for each row execute function public.set_updated_at();
drop trigger if exists job_applicants_set_updated_at on public.job_applicants;
create trigger job_applicants_set_updated_at before update on public.job_applicants
  for each row execute function public.set_updated_at();

alter table public.intake_forms enable row level security;
alter table public.job_applicants enable row level security;

-- Submissions are inserted by the public endpoint via the service-role admin
-- client (bypasses RLS). Authenticated access is owner/admin only — hiring +
-- applicant PII is sensitive.
create policy "admins manage intake forms" on public.intake_forms for all
  to authenticated
  using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

create policy "admins manage job applicants" on public.job_applicants for all
  to authenticated
  using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- Seed one job-application intake form per existing org so there's a ready URL.
insert into public.intake_forms (organization_id, name, type, token)
select o.id, 'Job application form', 'job_application',
       'frm_' || replace(gen_random_uuid()::text, '-', '')
from public.organizations o
where not exists (
  select 1 from public.intake_forms f
  where f.organization_id = o.id and f.type = 'job_application'
);
