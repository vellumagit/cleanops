-- Network contacts — the rolodex of people who matter but aren't clients.
--
-- Brian (Aug 30 meeting): realtors, property managers, suppliers — people
-- you need on speed dial and want notes on, who have no business being in
-- the clients table (no bookings, no invoices, no lifecycle). Deliberately
-- its own table rather than a client flavor: the leads model already
-- taught us that "client with a column" drags the whole billing/portal
-- machinery along for people it can never apply to.
--
-- Same access shape as freelancer_contacts: org-scoped, owner/admin/
-- manager for everything, direct RLS writes from the user client.

create table if not exists public.network_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(name) between 1 and 200),
  category        text not null default 'other'
                  check (category in ('realtor', 'property_manager', 'supplier', 'referral_partner', 'other')),
  company         text,
  phone           text,
  email           text,
  notes           text,
  created_by      uuid references public.memberships(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists network_contacts_org_idx
  on public.network_contacts (organization_id, category);

alter table public.network_contacts enable row level security;

drop policy if exists "managers_all_network_contacts" on public.network_contacts;
create policy "managers_all_network_contacts"
  on public.network_contacts for all
  to authenticated
  using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
  with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop trigger if exists network_contacts_set_updated_at on public.network_contacts;
create trigger network_contacts_set_updated_at
before update on public.network_contacts
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
