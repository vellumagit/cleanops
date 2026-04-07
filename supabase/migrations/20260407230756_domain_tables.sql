-- =============================================================================
-- CleanOps Phase 2 — Domain schema (tables, enums, indexes, triggers)
-- =============================================================================
-- Adds every domain table needed for the ops console and field app:
--   clients, packages, bookings, estimates (+ line items), contracts,
--   invoices (+ line items), reviews, training (modules/steps/assignments),
--   inventory (items + log), time_entries, bonuses, chat (threads/members/
--   messages), and the system-wide audit_log.
--
-- Every domain table has:
--   - id uuid pk
--   - organization_id uuid (RLS policies in the 0003 migration enforce tenancy)
--   - created_at + updated_at with auto-touch trigger where applicable
--   - indexes on every foreign key
--
-- RLS is enabled + forced on every table in this migration, but policies
-- are defined in the next migration (0003_domain_rls.sql) so they can be
-- iterated independently from the table schema.
--
-- Child tables that reference a parent (e.g. invoice_line_items → invoices)
-- carry a denormalized organization_id to simplify RLS policies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'preferred_contact') then
    create type public.preferred_contact as enum ('phone', 'email', 'sms');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'service_type') then
    create type public.service_type as enum ('standard', 'deep', 'move_out', 'recurring');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'booking_status') then
    create type public.booking_status as enum (
      'pending', 'confirmed', 'en_route', 'in_progress', 'completed', 'cancelled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_status') then
    create type public.estimate_status as enum ('draft', 'sent', 'approved', 'declined');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_line_kind') then
    create type public.estimate_line_kind as enum ('labour', 'supplies', 'extras');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type public.contract_status as enum ('active', 'ended', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type public.invoice_status as enum ('draft', 'sent', 'paid', 'overdue');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_category') then
    create type public.inventory_category as enum ('chemical', 'equipment', 'consumable');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'bonus_status') then
    create type public.bonus_status as enum ('pending', 'paid');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'chat_thread_kind') then
    create type public.chat_thread_kind as enum ('dm', 'group');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Table: clients
-- -----------------------------------------------------------------------------

create table if not exists public.clients (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null check (length(name) between 1 and 200),
  address             text,
  phone               text,
  email               citext,
  preferred_contact   public.preferred_contact not null default 'email',
  notes               text,
  balance_cents       integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists clients_organization_id_idx on public.clients (organization_id);
create index if not exists clients_email_idx on public.clients (email);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: packages
-- -----------------------------------------------------------------------------

create table if not exists public.packages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null check (length(name) between 1 and 120),
  description         text,
  price_cents         integer not null check (price_cents >= 0),
  duration_minutes    integer not null check (duration_minutes > 0),
  included            jsonb not null default '[]'::jsonb,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists packages_organization_id_idx on public.packages (organization_id);

drop trigger if exists packages_set_updated_at on public.packages;
create trigger packages_set_updated_at
before update on public.packages
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: bookings
-- -----------------------------------------------------------------------------

create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete restrict,
  address             text,
  scheduled_at        timestamptz not null,
  duration_minutes    integer not null check (duration_minutes > 0),
  service_type        public.service_type not null,
  package_id          uuid references public.packages(id) on delete set null,
  hourly_rate_cents   integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  assigned_to         uuid references public.memberships(id) on delete set null,
  status              public.booking_status not null default 'pending',
  notes               text,
  total_cents         integer not null default 0 check (total_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists bookings_organization_id_idx on public.bookings (organization_id);
create index if not exists bookings_client_id_idx on public.bookings (client_id);
create index if not exists bookings_assigned_to_idx on public.bookings (assigned_to);
create index if not exists bookings_scheduled_at_idx on public.bookings (scheduled_at);
create index if not exists bookings_status_idx on public.bookings (status);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: estimates
-- -----------------------------------------------------------------------------

create table if not exists public.estimates (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete restrict,
  service_description   text,
  status                public.estimate_status not null default 'draft',
  total_cents           integer not null default 0 check (total_cents >= 0),
  notes                 text,
  sent_at               timestamptz,
  decided_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists estimates_organization_id_idx on public.estimates (organization_id);
create index if not exists estimates_client_id_idx on public.estimates (client_id);
create index if not exists estimates_status_idx on public.estimates (status);

drop trigger if exists estimates_set_updated_at on public.estimates;
create trigger estimates_set_updated_at
before update on public.estimates
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: estimate_line_items
-- -----------------------------------------------------------------------------

create table if not exists public.estimate_line_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  estimate_id         uuid not null references public.estimates(id) on delete cascade,
  label               text not null,
  quantity            numeric(10,2) not null default 1 check (quantity >= 0),
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  kind                public.estimate_line_kind not null default 'labour',
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists estimate_line_items_estimate_id_idx on public.estimate_line_items (estimate_id);
create index if not exists estimate_line_items_organization_id_idx on public.estimate_line_items (organization_id);

-- -----------------------------------------------------------------------------
-- Table: contracts
-- -----------------------------------------------------------------------------

create table if not exists public.contracts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete restrict,
  estimate_id           uuid references public.estimates(id) on delete set null,
  service_type          public.service_type not null,
  start_date            date not null,
  end_date              date,
  agreed_price_cents    integer not null check (agreed_price_cents >= 0),
  payment_terms         text,
  status                public.contract_status not null default 'active',
  pdf_url               text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists contracts_organization_id_idx on public.contracts (organization_id);
create index if not exists contracts_client_id_idx on public.contracts (client_id);
create index if not exists contracts_estimate_id_idx on public.contracts (estimate_id);
create index if not exists contracts_status_idx on public.contracts (status);

drop trigger if exists contracts_set_updated_at on public.contracts;
create trigger contracts_set_updated_at
before update on public.contracts
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: invoices
-- -----------------------------------------------------------------------------

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete restrict,
  booking_id          uuid references public.bookings(id) on delete set null,
  amount_cents        integer not null default 0 check (amount_cents >= 0),
  status              public.invoice_status not null default 'draft',
  due_date            date,
  sent_at             timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists invoices_organization_id_idx on public.invoices (organization_id);
create index if not exists invoices_client_id_idx on public.invoices (client_id);
create index if not exists invoices_booking_id_idx on public.invoices (booking_id);
create index if not exists invoices_status_idx on public.invoices (status);
create index if not exists invoices_due_date_idx on public.invoices (due_date);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: invoice_line_items
-- -----------------------------------------------------------------------------

create table if not exists public.invoice_line_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  label               text not null,
  quantity            numeric(10,2) not null default 1 check (quantity >= 0),
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);
create index if not exists invoice_line_items_organization_id_idx on public.invoice_line_items (organization_id);

-- -----------------------------------------------------------------------------
-- Table: reviews
-- -----------------------------------------------------------------------------

create table if not exists public.reviews (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  booking_id          uuid references public.bookings(id) on delete set null,
  client_id           uuid references public.clients(id) on delete set null,
  employee_id         uuid references public.memberships(id) on delete set null,
  rating              smallint not null check (rating between 1 and 5),
  comment             text,
  submitted_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists reviews_organization_id_idx on public.reviews (organization_id);
create index if not exists reviews_booking_id_idx on public.reviews (booking_id);
create index if not exists reviews_employee_id_idx on public.reviews (employee_id);
create index if not exists reviews_client_id_idx on public.reviews (client_id);
create index if not exists reviews_rating_idx on public.reviews (rating);

-- -----------------------------------------------------------------------------
-- Table: training_modules
-- -----------------------------------------------------------------------------

create table if not exists public.training_modules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  title               text not null check (length(title) between 1 and 200),
  description         text,
  created_by          uuid references public.memberships(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists training_modules_organization_id_idx on public.training_modules (organization_id);

drop trigger if exists training_modules_set_updated_at on public.training_modules;
create trigger training_modules_set_updated_at
before update on public.training_modules
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: training_steps
-- -----------------------------------------------------------------------------

create table if not exists public.training_steps (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  module_id           uuid not null references public.training_modules(id) on delete cascade,
  ord                 integer not null default 0,
  body                text not null,
  image_url           text,
  created_at          timestamptz not null default now(),
  unique (module_id, ord)
);

create index if not exists training_steps_module_id_idx on public.training_steps (module_id);
create index if not exists training_steps_organization_id_idx on public.training_steps (organization_id);

-- -----------------------------------------------------------------------------
-- Table: training_assignments
-- -----------------------------------------------------------------------------

create table if not exists public.training_assignments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  module_id           uuid not null references public.training_modules(id) on delete cascade,
  employee_id         uuid not null references public.memberships(id) on delete cascade,
  completed_step_ids  uuid[] not null default '{}'::uuid[],
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (module_id, employee_id)
);

create index if not exists training_assignments_module_id_idx on public.training_assignments (module_id);
create index if not exists training_assignments_employee_id_idx on public.training_assignments (employee_id);
create index if not exists training_assignments_organization_id_idx on public.training_assignments (organization_id);

drop trigger if exists training_assignments_set_updated_at on public.training_assignments;
create trigger training_assignments_set_updated_at
before update on public.training_assignments
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: inventory_items
-- -----------------------------------------------------------------------------

create table if not exists public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null check (length(name) between 1 and 200),
  category            public.inventory_category not null,
  quantity            integer not null default 0 check (quantity >= 0),
  reorder_threshold   integer not null default 0 check (reorder_threshold >= 0),
  assigned_to         uuid references public.memberships(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists inventory_items_organization_id_idx on public.inventory_items (organization_id);
create index if not exists inventory_items_assigned_to_idx on public.inventory_items (assigned_to);

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: inventory_log
-- -----------------------------------------------------------------------------

create table if not exists public.inventory_log (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  item_id             uuid not null references public.inventory_items(id) on delete cascade,
  delta               integer not null,
  reason              text,
  actor_id            uuid references public.memberships(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists inventory_log_item_id_idx on public.inventory_log (item_id);
create index if not exists inventory_log_organization_id_idx on public.inventory_log (organization_id);

-- -----------------------------------------------------------------------------
-- Table: time_entries
-- -----------------------------------------------------------------------------

create table if not exists public.time_entries (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.memberships(id) on delete cascade,
  booking_id          uuid references public.bookings(id) on delete set null,
  clock_in_at         timestamptz not null default now(),
  clock_out_at        timestamptz,
  clock_in_lat        numeric(9,6),
  clock_in_lng        numeric(9,6),
  clock_out_lat       numeric(9,6),
  clock_out_lng       numeric(9,6),
  notes               text,
  created_at          timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);

create index if not exists time_entries_employee_id_idx on public.time_entries (employee_id);
create index if not exists time_entries_organization_id_idx on public.time_entries (organization_id);
create index if not exists time_entries_booking_id_idx on public.time_entries (booking_id);

-- At most one OPEN time entry (clock_out_at is null) per employee at a time.
create unique index if not exists time_entries_one_open_per_employee
  on public.time_entries (employee_id)
  where clock_out_at is null;

-- -----------------------------------------------------------------------------
-- Table: bonuses
-- -----------------------------------------------------------------------------

create table if not exists public.bonuses (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  employee_id         uuid not null references public.memberships(id) on delete cascade,
  period_start        date not null,
  period_end          date not null,
  amount_cents        integer not null check (amount_cents >= 0),
  reason              text,
  status              public.bonus_status not null default 'pending',
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists bonuses_organization_id_idx on public.bonuses (organization_id);
create index if not exists bonuses_employee_id_idx on public.bonuses (employee_id);
create index if not exists bonuses_status_idx on public.bonuses (status);

drop trigger if exists bonuses_set_updated_at on public.bonuses;
create trigger bonuses_set_updated_at
before update on public.bonuses
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Table: chat_threads
-- -----------------------------------------------------------------------------

create table if not exists public.chat_threads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  kind                public.chat_thread_kind not null,
  name                text,
  created_at          timestamptz not null default now()
);

create index if not exists chat_threads_organization_id_idx on public.chat_threads (organization_id);

-- -----------------------------------------------------------------------------
-- Table: chat_thread_members
-- -----------------------------------------------------------------------------

create table if not exists public.chat_thread_members (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  thread_id           uuid not null references public.chat_threads(id) on delete cascade,
  membership_id       uuid not null references public.memberships(id) on delete cascade,
  joined_at           timestamptz not null default now(),
  unique (thread_id, membership_id)
);

create index if not exists chat_thread_members_thread_id_idx on public.chat_thread_members (thread_id);
create index if not exists chat_thread_members_membership_id_idx on public.chat_thread_members (membership_id);
create index if not exists chat_thread_members_organization_id_idx on public.chat_thread_members (organization_id);

-- -----------------------------------------------------------------------------
-- Table: chat_messages
-- -----------------------------------------------------------------------------

create table if not exists public.chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  thread_id           uuid not null references public.chat_threads(id) on delete cascade,
  sender_id           uuid references public.memberships(id) on delete set null,
  body                text not null check (length(body) between 1 and 10000),
  attachments         jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists chat_messages_thread_id_created_at_idx on public.chat_messages (thread_id, created_at desc);
create index if not exists chat_messages_organization_id_idx on public.chat_messages (organization_id);

-- -----------------------------------------------------------------------------
-- Table: audit_log
-- -----------------------------------------------------------------------------

create table if not exists public.audit_log (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  actor_id            uuid references public.memberships(id) on delete set null,
  action              text not null,
  entity              text not null,
  entity_id           uuid,
  before              jsonb,
  after               jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists audit_log_organization_id_created_at_idx
  on public.audit_log (organization_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);

-- =============================================================================
-- Enable + force RLS on every table (policies come in the next migration)
-- =============================================================================

alter table public.clients               enable row level security;
alter table public.packages              enable row level security;
alter table public.bookings              enable row level security;
alter table public.estimates             enable row level security;
alter table public.estimate_line_items   enable row level security;
alter table public.contracts             enable row level security;
alter table public.invoices              enable row level security;
alter table public.invoice_line_items    enable row level security;
alter table public.reviews               enable row level security;
alter table public.training_modules      enable row level security;
alter table public.training_steps        enable row level security;
alter table public.training_assignments  enable row level security;
alter table public.inventory_items       enable row level security;
alter table public.inventory_log         enable row level security;
alter table public.time_entries          enable row level security;
alter table public.bonuses               enable row level security;
alter table public.chat_threads          enable row level security;
alter table public.chat_thread_members   enable row level security;
alter table public.chat_messages         enable row level security;
alter table public.audit_log             enable row level security;

alter table public.clients               force row level security;
alter table public.packages              force row level security;
alter table public.bookings              force row level security;
alter table public.estimates             force row level security;
alter table public.estimate_line_items   force row level security;
alter table public.contracts             force row level security;
alter table public.invoices              force row level security;
alter table public.invoice_line_items    force row level security;
alter table public.reviews               force row level security;
alter table public.training_modules      force row level security;
alter table public.training_steps        force row level security;
alter table public.training_assignments  force row level security;
alter table public.inventory_items       force row level security;
alter table public.inventory_log         force row level security;
alter table public.time_entries          force row level security;
alter table public.bonuses               force row level security;
alter table public.chat_threads          force row level security;
alter table public.chat_thread_members   force row level security;
alter table public.chat_messages         force row level security;
alter table public.audit_log             force row level security;

-- =============================================================================
-- Table comments
-- =============================================================================

comment on table public.clients is 'Customers the cleaning company serves.';
comment on table public.packages is 'Reusable service packages (Basic, Deep Clean, etc).';
comment on table public.bookings is 'Scheduled cleaning jobs. Links client + optional package + assigned employee.';
comment on table public.estimates is 'Quotes sent to clients before a booking is confirmed.';
comment on table public.estimate_line_items is 'Line items on an estimate (labour, supplies, extras).';
comment on table public.contracts is 'Active or past service agreements with clients.';
comment on table public.invoices is 'Billing records sent to clients. Auto-generatable from completed bookings.';
comment on table public.invoice_line_items is 'Line items on an invoice.';
comment on table public.reviews is 'Client-submitted ratings of jobs performed.';
comment on table public.training_modules is 'Admin-created training content for employees.';
comment on table public.training_steps is 'Ordered steps within a training module (text + optional image).';
comment on table public.training_assignments is 'Per-employee completion state for a training module.';
comment on table public.inventory_items is 'Cleaning supplies and equipment tracked in the ops console.';
comment on table public.inventory_log is 'Per-item restock/usage deltas for auditability.';
comment on table public.time_entries is 'Clock in/out records for employees, geolocated.';
comment on table public.bonuses is 'Performance bonuses earned by employees (based on review scores, etc).';
comment on table public.chat_threads is 'DM and group chat threads within an organization.';
comment on table public.chat_thread_members is 'Membership in a chat thread.';
comment on table public.chat_messages is 'Individual messages in a chat thread.';
comment on table public.audit_log is 'Append-only log of sensitive mutations — who did what when.';
