-- =============================================================================
-- Add 'manager' role to membership_role enum
--
-- Managers get full dashboard access (bookings, clients, invoices, etc.)
-- but cannot change org settings, integrations, or billing.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'manager'
      and enumtypid = 'public.membership_role'::regtype
  ) then
    alter type public.membership_role add value 'manager' after 'admin';
  end if;
end $$;
