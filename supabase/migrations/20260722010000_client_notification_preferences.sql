-- =============================================================================
-- Per-client notification preferences (default + override model)
-- =============================================================================
-- Org sets a house default; each client is inherit / custom / do_not_contact.
-- The policy engine that reads these is src/lib/notification-preferences.ts.
--
-- BACK-COMPAT: everything seeds to today's behaviour — org default 'email',
-- every client 'inherit' — so nothing changes for anyone until an owner acts.
-- The old cosmetic clients.preferred_contact (never read by any send path) is
-- left in place and superseded; a later migration can drop it once the UI no
-- longer references it.
-- =============================================================================

alter table public.organizations
  add column if not exists default_contact_preference text not null default 'email';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_default_contact_pref_chk'
  ) then
    alter table public.organizations
      add constraint organizations_default_contact_pref_chk
      check (default_contact_preference in ('email','sms','both','none'));
  end if;
end $$;

alter table public.clients
  add column if not exists contact_preference text not null default 'inherit',
  add column if not exists contact_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_contact_pref_chk'
  ) then
    alter table public.clients
      add constraint clients_contact_pref_chk
      check (contact_preference in ('inherit','custom','do_not_contact'));
  end if;
end $$;

comment on column public.organizations.default_contact_preference is
  'House default for automated client messages: email | sms | both | none. Clients on contact_preference=inherit follow this.';
comment on column public.clients.contact_preference is
  'inherit (follow org default) | custom (per-category channels in contact_overrides) | do_not_contact (no automated messages).';
comment on column public.clients.contact_overrides is
  'When contact_preference=custom: { booking|billing|growth : off|email|sms|both|inherit }. Absent category = inherit org default.';
