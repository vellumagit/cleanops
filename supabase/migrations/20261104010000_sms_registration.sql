-- ============================================================
-- US texting registration (A2P 10DLC), one per organization
-- ============================================================
--
-- US carriers block business texts from a local number until the business
-- is registered with them: a Trust Hub customer profile and A2P profile
-- (who the business is), a brand (the carriers' record of it), and a
-- campaign (what it will text, and how people opt in). Sollos registers
-- each US business under its own approved ISV profile through Twilio's API
-- (src/lib/twilio-a2p.ts) and only buys the business's number once the
-- campaign is approved. Canadian businesses don't go through this.
--
-- The row is the owner's answers plus where Twilio has got to. Every
-- Twilio object id is stored as soon as it exists, so a step that fails
-- halfway is resumed, never repeated (repeating a brand registration
-- charges again). The EIN is stored encrypted inside `details`.
--
-- Read by owners/admins of the org; all writes go through service-role
-- server actions and the hourly cron.

create table if not exists public.sms_registrations (
  organization_id        uuid primary key references public.organizations(id) on delete cascade,
  country                text not null default 'US' check (country in ('US')),
  status                 text not null default 'draft'
    check (status in ('draft', 'submitted', 'brand_review', 'campaign_review', 'approved', 'needs_changes')),
  -- What the owner entered (see src/lib/sms-registration-rules.ts).
  details                jsonb not null default '{}'::jsonb,
  -- Twilio object ids created so far, by step name.
  twilio                 jsonb not null default '{}'::jsonb,
  -- The latest word from Twilio or the carriers, in plain language.
  status_detail          text,
  submitted_at           timestamptz,
  approved_at            timestamptz,
  last_checked_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists sms_registrations_open_idx
  on public.sms_registrations (status)
  where status in ('submitted', 'brand_review', 'campaign_review');

alter table public.sms_registrations enable row level security;

drop policy if exists sms_registrations_select on public.sms_registrations;
create policy sms_registrations_select
  on public.sms_registrations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.organization_id = sms_registrations.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.status = 'active'
    )
  );

-- The org's texting Messaging Service, for US numbers. Canadian numbers
-- keep sending from the bare number as before.
alter table public.organizations
  add column if not exists sms_messaging_service_sid text;

notify pgrst, 'reload schema';
