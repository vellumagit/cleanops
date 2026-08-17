-- =============================================================================
-- A client can be a business, without stopping being a person
-- supabase/migrations/20260818010000_client_company_name.sql
-- =============================================================================
-- Svit cleans for people who run businesses from home. The invoice has to be
-- addressed to the COMPANY — that is what their bookkeeper files and what
-- their accountant expects to see against the expense — but everything else
-- about the relationship is still a person: the one who answers the phone,
-- gets the reminder text, and opens the door.
--
-- Same shape as client_properties: one client, one payer, and an attribute
-- that only some of them have. Deliberately NOT a separate table — a company
-- name is one string belonging to the client, not a thing with a life of its
-- own, and a join would buy nothing.
--
-- Where it applies is a rule the app enforces, not the database:
--   money documents  → the COMPANY (invoice, statement, PDF, hosted page)
--   everything else  → the PERSON (bookings, schedule, SMS, portal, chat)
-- Blank for the overwhelming majority of clients, and blank behaves exactly
-- as today, so nothing changes for anyone who does not set it.

alter table public.clients
  add column if not exists company_name text;

comment on column public.clients.company_name is
  'Legal/business name to invoice under, for clients who run a business. When set, money documents bill the COMPANY and name the client as the contact; everything else in the app keeps using clients.name. NULL/blank = invoice the person, which is the default and the common case.';

notify pgrst, 'reload schema';
