-- -----------------------------------------------------------------------------
-- Org-level default payment instructions
--
-- Phase 12 Part 1. The per-org default that gets copied onto every new
-- invoice. Each invoice also has its own `payment_instructions` column
-- that can override the default (e.g. "for this one, pay via check").
--
-- Kept on `organizations` (not a separate settings table) because this
-- is the only customization we have at this level today and adding a
-- whole table for one text column is overkill. When the list grows
-- past ~3 settings we'll factor out an `organization_settings` table.
-- -----------------------------------------------------------------------------

alter table public.organizations
  add column if not exists default_payment_instructions text;

comment on column public.organizations.default_payment_instructions is
  'Free-form markdown-ish text shown to clients on public invoice pages by default. Individual invoices can override via invoices.payment_instructions.';
