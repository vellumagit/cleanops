-- =============================================================================
-- A lead is a client who hasn't said yes yet
-- supabase/migrations/20260820010000_client_lifecycle_leads.sql
-- =============================================================================
-- Svitlana's inquiries arrive three ways: the form on her website, her phone,
-- and email. Only the form reaches software, and it lands in the worst possible
-- place — the public estimates API calls findOrCreateClient, so every person
-- who ever asked for a price became a permanent client record. On the day this
-- was written 19 of her 79 clients had never been booked or invoiced. A quarter
-- of the client list was not customers, and she had nowhere else to put them,
-- so she was already using the client list as a lead list by hand.
--
-- FOUR COLUMNS, NOT A NEW TABLE. A lead and a client hold identical
-- information — name, phone, email, address, what they want. The only thing
-- that differs is whether they've said yes. Model that as an attribute and
-- estimates, notes, properties and SMS all keep working untouched; conversion
-- becomes one column flip instead of copying rows between tables and re-parenting
-- everything that pointed at the old one. A separate leads table would force
-- every one of those features to handle two possible parents forever, which is
-- a permanent tax for a distinction that is genuinely one field.
--
-- DEFAULT 'client', so every existing row keeps behaving exactly as it does
-- today and nothing disappears from a list the morning this runs. Leads only
-- exist once something deliberately creates one.
--
-- The cost, stated honestly: leads now live in the clients table, so every
-- client LIST has to filter them out. That work follows the archived_at
-- pattern already established in this codebase. Reads of a single client by id
-- — the large majority — are unaffected.

alter table public.clients
  add column if not exists lifecycle text not null default 'client',
  add column if not exists lead_stage text,
  add column if not exists lead_source text,
  add column if not exists lead_note text;

-- 'lost' is a lifecycle rather than a lead_stage on purpose: a lost lead is no
-- longer in the pipeline at all, and leaving it as a stage would mean every
-- query for "my leads" had to remember to exclude it.
alter table public.clients
  drop constraint if exists clients_lifecycle_check;
alter table public.clients
  add constraint clients_lifecycle_check
  check (lifecycle in ('lead', 'client', 'lost'));

alter table public.clients
  drop constraint if exists clients_lead_stage_check;
alter table public.clients
  add constraint clients_lead_stage_check
  check (lead_stage is null or lead_stage in ('new', 'contacted', 'quoted'));

comment on column public.clients.lifecycle is
  'Where this person sits: lead (asked, hasn''t said yes), client (a customer — the default and what every pre-existing row is), or lost. Client LISTS must filter to lifecycle = ''client''; reads by id do not care. Booking a lead flips this to client automatically, because booking someone IS the close.';

comment on column public.clients.lead_stage is
  'Pipeline position while lifecycle = ''lead'': new, contacted, quoted. NULL for anyone who is not a lead. Deliberately not used to record won/lost — those are lifecycle values, so "show me my leads" cannot accidentally include a dead one.';

comment on column public.clients.lead_source is
  'Where the inquiry came from: web_form, phone, email, referral, other. Only web_form is ever set automatically — the rest are typed in, because a phone call cannot be captured by software.';

comment on column public.clients.lead_note is
  'What they actually asked for, in their words or Svitlana''s. One free-text line, because the alternative is a form nobody fills in while holding a phone.';

-- The leads list, and the sidebar's count of new ones. Partial so it stays
-- small: leads are a working set of a few dozen, clients accumulate forever.
create index if not exists clients_leads_idx
  on public.clients (organization_id, lead_stage)
  where lifecycle = 'lead';

notify pgrst, 'reload schema';
