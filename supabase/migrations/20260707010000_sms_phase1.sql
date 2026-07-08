-- SMS Phase 1 — self-serve per-org texting (outbound + metered billing).
--
-- Adds the per-org SMS config (own number, master switch, overage cap + Stripe
-- item link), a consent audit stamp on clients, and the sms_messages ledger
-- that (a) backs the monthly usage/allotment count and (b) is the foundation
-- for the Phase 2 two-way inbox. See docs/sms-phase1-spec.md.

-- ── organizations: per-org SMS config ──────────────────────────────────────
alter table public.organizations
  add column if not exists sms_enabled            boolean not null default false,
  add column if not exists sms_from_number        text,
  add column if not exists sms_number_sid         text,
  add column if not exists sms_overage_cap_cents  integer not null default 5000,
  add column if not exists sms_overage_item_id    text;

comment on column public.organizations.sms_enabled is
  'Master per-org SMS switch. Owner flips this on in Settings → SMS; provisions a number.';
comment on column public.organizations.sms_from_number is
  'The org''s own Twilio number (E.164). All org SMS sends From this. Null until provisioned.';
comment on column public.organizations.sms_number_sid is
  'Twilio IncomingPhoneNumber SID for the provisioned number (needed to release it).';
comment on column public.organizations.sms_overage_cap_cents is
  'Hard monthly overage ceiling (cents). SMS pauses when projected overage would exceed it. Default $50.';
comment on column public.organizations.sms_overage_item_id is
  'Stripe subscription item id for the metered overage price. Null for comped orgs (overage waived).';

-- ── clients: consent audit stamp (sms_opted_in boolean already exists) ──────
alter table public.clients
  add column if not exists sms_opted_in_at      timestamptz,
  add column if not exists sms_opt_in_source    text;

comment on column public.clients.sms_opted_in_at is
  'When SMS consent was recorded (CASL audit). Stamped when sms_opted_in flips true.';
comment on column public.clients.sms_opt_in_source is
  'How consent was captured (e.g. "client_form", "intake", "import"). CASL audit trail.';

-- ── sms_messages: usage ledger + Phase-2 inbox foundation ───────────────────
create table if not exists public.sms_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  direction        text not null default 'outbound'
                     check (direction in ('outbound', 'inbound')),
  to_number        text not null,
  from_number      text,
  body             text not null,
  segments         integer not null default 1,
  status           text,               -- 'sent' | 'skipped_disabled' | 'failed' | provider status
  twilio_sid       text,
  client_id        uuid references public.clients(id) on delete set null,
  automation_key   text,               -- which automation produced it (booking_reminder_client_sms, …)
  is_overage       boolean not null default false,  -- counted past the plan's included allotment
  created_at       timestamptz not null default now()
);

-- Monthly outbound count per org (the allotment gate) reads this hot path.
create index if not exists sms_messages_org_created_idx
  on public.sms_messages (organization_id, created_at desc);
create index if not exists sms_messages_org_dir_created_idx
  on public.sms_messages (organization_id, direction, created_at);

-- RLS: management (owner/admin/manager) may read their org's SMS log; cleaners
-- may not (client contact history is management data). All writes go through
-- the service-role client (bypasses RLS), so there are no insert/update/delete
-- policies — direct writes from an RLS-bound session are denied.
alter table public.sms_messages enable row level security;
alter table public.sms_messages force row level security;

drop policy if exists "management reads org sms" on public.sms_messages;
create policy "management reads org sms"
on public.sms_messages for select
using (
  exists (
    select 1 from public.memberships m
    where m.organization_id = sms_messages.organization_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'manager')
  )
);

notify pgrst, 'reload schema';
