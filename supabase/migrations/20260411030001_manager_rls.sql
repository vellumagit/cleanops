-- =============================================================================
-- Update RLS policies to include 'manager' role
--
-- Managers get full read/write access to operational tables (clients,
-- packages, bookings, estimates, contracts, invoices, inventory,
-- training, freelancers, reviews, bonuses, time entries, chat).
--
-- Managers do NOT get access to:
--   - integration_connections (settings)
--   - memberships write (can't invite/remove people)
--   - invitations (can't send invites)
--   - audit_log read (admin-only)
--   - organization settings update (owner-only)
-- =============================================================================

-- ---- clients ----------------------------------------------------------------
drop policy if exists "admins write clients" on public.clients;
create policy "admins write clients"
on public.clients for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update clients" on public.clients;
create policy "admins update clients"
on public.clients for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete clients" on public.clients;
create policy "admins delete clients"
on public.clients for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- packages ---------------------------------------------------------------
drop policy if exists "admins insert packages" on public.packages;
create policy "admins insert packages"
on public.packages for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update packages" on public.packages;
create policy "admins update packages"
on public.packages for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete packages" on public.packages;
create policy "admins delete packages"
on public.packages for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- bookings ---------------------------------------------------------------
drop policy if exists "admins insert bookings" on public.bookings;
create policy "admins insert bookings"
on public.bookings for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins or assignee update bookings" on public.bookings;
create policy "admins or assignee update bookings"
on public.bookings for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    assigned_to in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    assigned_to in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

drop policy if exists "admins delete bookings" on public.bookings;
create policy "admins delete bookings"
on public.bookings for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- estimates --------------------------------------------------------------
drop policy if exists "admins insert estimates" on public.estimates;
create policy "admins insert estimates"
on public.estimates for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update estimates" on public.estimates;
create policy "admins update estimates"
on public.estimates for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete estimates" on public.estimates;
create policy "admins delete estimates"
on public.estimates for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- estimate_line_items ----------------------------------------------------
drop policy if exists "admins insert estimate_line_items" on public.estimate_line_items;
create policy "admins insert estimate_line_items"
on public.estimate_line_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update estimate_line_items" on public.estimate_line_items;
create policy "admins update estimate_line_items"
on public.estimate_line_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete estimate_line_items" on public.estimate_line_items;
create policy "admins delete estimate_line_items"
on public.estimate_line_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- contracts --------------------------------------------------------------
drop policy if exists "admins insert contracts" on public.contracts;
create policy "admins insert contracts"
on public.contracts for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update contracts" on public.contracts;
create policy "admins update contracts"
on public.contracts for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete contracts" on public.contracts;
create policy "admins delete contracts"
on public.contracts for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- invoices ---------------------------------------------------------------
drop policy if exists "admins insert invoices" on public.invoices;
create policy "admins insert invoices"
on public.invoices for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update invoices" on public.invoices;
create policy "admins update invoices"
on public.invoices for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete invoices" on public.invoices;
create policy "admins delete invoices"
on public.invoices for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- invoice_line_items -----------------------------------------------------
drop policy if exists "admins insert invoice_line_items" on public.invoice_line_items;
create policy "admins insert invoice_line_items"
on public.invoice_line_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update invoice_line_items" on public.invoice_line_items;
create policy "admins update invoice_line_items"
on public.invoice_line_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete invoice_line_items" on public.invoice_line_items;
create policy "admins delete invoice_line_items"
on public.invoice_line_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- reviews ----------------------------------------------------------------
drop policy if exists "admins delete reviews" on public.reviews;
create policy "admins delete reviews"
on public.reviews for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- training_modules -------------------------------------------------------
drop policy if exists "admins insert training_modules" on public.training_modules;
create policy "admins insert training_modules"
on public.training_modules for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update training_modules" on public.training_modules;
create policy "admins update training_modules"
on public.training_modules for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete training_modules" on public.training_modules;
create policy "admins delete training_modules"
on public.training_modules for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- training_steps ---------------------------------------------------------
drop policy if exists "admins insert training_steps" on public.training_steps;
create policy "admins insert training_steps"
on public.training_steps for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update training_steps" on public.training_steps;
create policy "admins update training_steps"
on public.training_steps for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete training_steps" on public.training_steps;
create policy "admins delete training_steps"
on public.training_steps for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- training_assignments ---------------------------------------------------
drop policy if exists "assignees read own assignments or admins all" on public.training_assignments;
create policy "assignees read own assignments or admins all"
on public.training_assignments for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins insert training_assignments" on public.training_assignments;
create policy "admins insert training_assignments"
on public.training_assignments for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins or assignee update training_assignments" on public.training_assignments;
create policy "admins or assignee update training_assignments"
on public.training_assignments for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins delete training_assignments" on public.training_assignments;
create policy "admins delete training_assignments"
on public.training_assignments for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- inventory_items --------------------------------------------------------
drop policy if exists "admins insert inventory_items" on public.inventory_items;
create policy "admins insert inventory_items"
on public.inventory_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update inventory_items" on public.inventory_items;
create policy "admins update inventory_items"
on public.inventory_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete inventory_items" on public.inventory_items;
create policy "admins delete inventory_items"
on public.inventory_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- inventory_log ----------------------------------------------------------
drop policy if exists "admins insert inventory_log" on public.inventory_log;
create policy "admins insert inventory_log"
on public.inventory_log for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- time_entries -----------------------------------------------------------
drop policy if exists "members read own time_entries or admins all" on public.time_entries;
create policy "members read own time_entries or admins all"
on public.time_entries for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "employees update own open time_entries or admins all" on public.time_entries;
create policy "employees update own open time_entries or admins all"
on public.time_entries for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

drop policy if exists "admins delete time_entries" on public.time_entries;
create policy "admins delete time_entries"
on public.time_entries for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- bonuses ----------------------------------------------------------------
drop policy if exists "members read own bonuses or admins all" on public.bonuses;
create policy "members read own bonuses or admins all"
on public.bonuses for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins insert bonuses" on public.bonuses;
create policy "admins insert bonuses"
on public.bonuses for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update bonuses" on public.bonuses;
create policy "admins update bonuses"
on public.bonuses for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete bonuses" on public.bonuses;
create policy "admins delete bonuses"
on public.bonuses for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- chat -------------------------------------------------------------------
drop policy if exists "admins insert chat_threads" on public.chat_threads;
create policy "admins insert chat_threads"
on public.chat_threads for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete chat_threads" on public.chat_threads;
create policy "admins delete chat_threads"
on public.chat_threads for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert thread members" on public.chat_thread_members;
create policy "admins insert thread members"
on public.chat_thread_members for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete thread members" on public.chat_thread_members;
create policy "admins delete thread members"
on public.chat_thread_members for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "senders delete own messages" on public.chat_messages;
create policy "senders delete own messages"
on public.chat_messages for delete
to authenticated
using (
  sender_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  or public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[])
);

-- ---- invoice_payments -------------------------------------------------------
drop policy if exists "admins read invoice_payments" on public.invoice_payments;
create policy "admins read invoice_payments"
on public.invoice_payments for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert invoice_payments" on public.invoice_payments;
create policy "admins insert invoice_payments"
on public.invoice_payments for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update invoice_payments" on public.invoice_payments;
create policy "admins update invoice_payments"
on public.invoice_payments for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete invoice_payments" on public.invoice_payments;
create policy "admins delete invoice_payments"
on public.invoice_payments for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- freelancer tables ------------------------------------------------------
drop policy if exists "admins read freelancer_contacts" on public.freelancer_contacts;
create policy "admins read freelancer_contacts"
on public.freelancer_contacts for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert freelancer_contacts" on public.freelancer_contacts;
create policy "admins insert freelancer_contacts"
on public.freelancer_contacts for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update freelancer_contacts" on public.freelancer_contacts;
create policy "admins update freelancer_contacts"
on public.freelancer_contacts for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete freelancer_contacts" on public.freelancer_contacts;
create policy "admins delete freelancer_contacts"
on public.freelancer_contacts for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins read job_offers" on public.job_offers;
create policy "admins read job_offers"
on public.job_offers for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert job_offers" on public.job_offers;
create policy "admins insert job_offers"
on public.job_offers for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update job_offers" on public.job_offers;
create policy "admins update job_offers"
on public.job_offers for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete job_offers" on public.job_offers;
create policy "admins delete job_offers"
on public.job_offers for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins read job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins read job_offer_dispatches"
on public.job_offer_dispatches for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins insert job_offer_dispatches"
on public.job_offer_dispatches for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins update job_offer_dispatches"
on public.job_offer_dispatches for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete job_offer_dispatches" on public.job_offer_dispatches;
create policy "admins delete job_offer_dispatches"
on public.job_offer_dispatches for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- bonus_rules ------------------------------------------------------------
drop policy if exists "admins read bonus_rules" on public.bonus_rules;
create policy "admins read bonus_rules"
on public.bonus_rules for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins insert bonus_rules" on public.bonus_rules;
create policy "admins insert bonus_rules"
on public.bonus_rules for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins update bonus_rules" on public.bonus_rules;
create policy "admins update bonus_rules"
on public.bonus_rules for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

drop policy if exists "admins delete bonus_rules" on public.bonus_rules;
create policy "admins delete bonus_rules"
on public.bonus_rules for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- ---- reviews (admin insert from bonus_rules migration) ----------------------
drop policy if exists "admins insert reviews" on public.reviews;
create policy "admins insert reviews"
on public.reviews for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin','manager']::public.membership_role[]));

-- NOTE: The following remain owner/admin ONLY (no manager):
--   - integration_connections (settings)
--   - integration_events (settings)
--   - memberships insert/update/delete (people management)
--   - invitations insert/update/delete (people management)
--   - organizations update (org settings)
--   - audit_log select (sensitive history)
