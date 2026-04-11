-- =============================================================================
-- Sage Accounting integration
--
-- Adds sage to the integration_provider enum so orgs can connect their
-- Sage Business Cloud Accounting account for invoice + contact sync.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'sage'
      and enumtypid = 'public.integration_provider'::regtype
  ) then
    alter type public.integration_provider add value 'sage';
  end if;
end $$;

-- Cache the Sage contact id on clients (same pattern as quickbooks_customer_id)
alter table public.clients
  add column if not exists sage_contact_id text;

create index if not exists clients_sage_contact_id_idx
  on public.clients (sage_contact_id)
  where sage_contact_id is not null;

comment on column public.clients.sage_contact_id is
  'Cached Sage contact id once this client has been mirrored into the org''s Sage ledger.';
