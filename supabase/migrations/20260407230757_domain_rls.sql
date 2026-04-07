-- =============================================================================
-- CleanOps Phase 2 — Domain RLS policies
-- =============================================================================
-- Access control patterns used in this migration:
--
--   A. ADMIN-WRITE, MEMBER-READ
--      Members (any role) can SELECT. Only owner/admin can INSERT/UPDATE/DELETE.
--      Used for: clients, packages, bookings, estimates (+ lines), contracts,
--      invoices (+ lines), training_modules, training_steps, inventory_items,
--      inventory_log, bonuses.
--
--   B. MEMBER-WRITE (their own rows only), MEMBER-READ (org-scoped)
--      Members can SELECT anything in their org, but can only INSERT/UPDATE
--      their OWN rows. Used for: time_entries (employee writes own),
--      training_assignments (employee updates own completion).
--
--   C. CHAT — THREAD-MEMBERS ONLY
--      Read/write limited to rows where the user is a member of the thread,
--      AND the thread is in their org. Used for: chat_threads,
--      chat_thread_members, chat_messages.
--
--   D. REVIEWS — SPECIAL
--      Client-facing review submission happens via a service-role route
--      (the client isn't authenticated as an org member). Admins/owners can
--      delete reviews. Members can read all reviews in their org.
--
--   E. AUDIT LOG — APPEND-ONLY
--      Anyone authenticated can INSERT an audit row (guarded by server-side
--      action helpers). Only owner/admin can SELECT. Nobody UPDATEs or
--      DELETEs — even owners.
-- =============================================================================

-- Helper: shorthand for checking current user is active member of a given org.
-- Inline for clarity in each policy.

-- =============================================================================
-- clients — PATTERN A
-- =============================================================================

drop policy if exists "members read clients" on public.clients;
create policy "members read clients"
on public.clients for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins write clients" on public.clients;
create policy "admins write clients"
on public.clients for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update clients" on public.clients;
create policy "admins update clients"
on public.clients for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete clients" on public.clients;
create policy "admins delete clients"
on public.clients for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- packages — PATTERN A
-- =============================================================================

drop policy if exists "members read packages" on public.packages;
create policy "members read packages"
on public.packages for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert packages" on public.packages;
create policy "admins insert packages"
on public.packages for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update packages" on public.packages;
create policy "admins update packages"
on public.packages for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete packages" on public.packages;
create policy "admins delete packages"
on public.packages for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- bookings — PATTERN A (but employees can UPDATE status on their own jobs)
-- =============================================================================

drop policy if exists "members read bookings" on public.bookings;
create policy "members read bookings"
on public.bookings for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert bookings" on public.bookings;
create policy "admins insert bookings"
on public.bookings for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- Admins can update any booking; employees can update bookings assigned to them
-- (to change status from confirmed → en_route → in_progress → completed).
drop policy if exists "admins or assignee update bookings" on public.bookings;
create policy "admins or assignee update bookings"
on public.bookings for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or (
    assigned_to in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
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
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- estimates — PATTERN A
-- =============================================================================

drop policy if exists "members read estimates" on public.estimates;
create policy "members read estimates"
on public.estimates for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert estimates" on public.estimates;
create policy "admins insert estimates"
on public.estimates for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update estimates" on public.estimates;
create policy "admins update estimates"
on public.estimates for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete estimates" on public.estimates;
create policy "admins delete estimates"
on public.estimates for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- estimate_line_items — PATTERN A
-- =============================================================================

drop policy if exists "members read estimate_line_items" on public.estimate_line_items;
create policy "members read estimate_line_items"
on public.estimate_line_items for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert estimate_line_items" on public.estimate_line_items;
create policy "admins insert estimate_line_items"
on public.estimate_line_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update estimate_line_items" on public.estimate_line_items;
create policy "admins update estimate_line_items"
on public.estimate_line_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete estimate_line_items" on public.estimate_line_items;
create policy "admins delete estimate_line_items"
on public.estimate_line_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- contracts — PATTERN A
-- =============================================================================

drop policy if exists "members read contracts" on public.contracts;
create policy "members read contracts"
on public.contracts for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert contracts" on public.contracts;
create policy "admins insert contracts"
on public.contracts for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update contracts" on public.contracts;
create policy "admins update contracts"
on public.contracts for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete contracts" on public.contracts;
create policy "admins delete contracts"
on public.contracts for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- invoices — PATTERN A
-- =============================================================================

drop policy if exists "members read invoices" on public.invoices;
create policy "members read invoices"
on public.invoices for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert invoices" on public.invoices;
create policy "admins insert invoices"
on public.invoices for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update invoices" on public.invoices;
create policy "admins update invoices"
on public.invoices for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete invoices" on public.invoices;
create policy "admins delete invoices"
on public.invoices for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- invoice_line_items — PATTERN A
-- =============================================================================

drop policy if exists "members read invoice_line_items" on public.invoice_line_items;
create policy "members read invoice_line_items"
on public.invoice_line_items for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert invoice_line_items" on public.invoice_line_items;
create policy "admins insert invoice_line_items"
on public.invoice_line_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update invoice_line_items" on public.invoice_line_items;
create policy "admins update invoice_line_items"
on public.invoice_line_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete invoice_line_items" on public.invoice_line_items;
create policy "admins delete invoice_line_items"
on public.invoice_line_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- reviews — PATTERN D
-- =============================================================================
-- Members of the org can read all reviews. Inserting reviews is handled via
-- a service-role route (Phase 7) because the submitter is typically a client,
-- not an authenticated org member. Admins can delete.

drop policy if exists "members read reviews" on public.reviews;
create policy "members read reviews"
on public.reviews for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins delete reviews" on public.reviews;
create policy "admins delete reviews"
on public.reviews for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- training_modules — PATTERN A
-- =============================================================================

drop policy if exists "members read training_modules" on public.training_modules;
create policy "members read training_modules"
on public.training_modules for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert training_modules" on public.training_modules;
create policy "admins insert training_modules"
on public.training_modules for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update training_modules" on public.training_modules;
create policy "admins update training_modules"
on public.training_modules for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete training_modules" on public.training_modules;
create policy "admins delete training_modules"
on public.training_modules for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- training_steps — PATTERN A
-- =============================================================================

drop policy if exists "members read training_steps" on public.training_steps;
create policy "members read training_steps"
on public.training_steps for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert training_steps" on public.training_steps;
create policy "admins insert training_steps"
on public.training_steps for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update training_steps" on public.training_steps;
create policy "admins update training_steps"
on public.training_steps for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete training_steps" on public.training_steps;
create policy "admins delete training_steps"
on public.training_steps for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- training_assignments — PATTERN B
-- Employees can SELECT + UPDATE their OWN assignment. Admins can do anything.
-- =============================================================================

drop policy if exists "assignees read own assignments or admins all" on public.training_assignments;
create policy "assignees read own assignments or admins all"
on public.training_assignments for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins insert training_assignments" on public.training_assignments;
create policy "admins insert training_assignments"
on public.training_assignments for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins or assignee update training_assignments" on public.training_assignments;
create policy "admins or assignee update training_assignments"
on public.training_assignments for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins delete training_assignments" on public.training_assignments;
create policy "admins delete training_assignments"
on public.training_assignments for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- inventory_items — PATTERN A
-- =============================================================================

drop policy if exists "members read inventory_items" on public.inventory_items;
create policy "members read inventory_items"
on public.inventory_items for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert inventory_items" on public.inventory_items;
create policy "admins insert inventory_items"
on public.inventory_items for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update inventory_items" on public.inventory_items;
create policy "admins update inventory_items"
on public.inventory_items for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete inventory_items" on public.inventory_items;
create policy "admins delete inventory_items"
on public.inventory_items for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- inventory_log — PATTERN A (read-only history; admins insert)
-- =============================================================================

drop policy if exists "members read inventory_log" on public.inventory_log;
create policy "members read inventory_log"
on public.inventory_log for select
to authenticated
using (organization_id in (select public.current_user_org_ids()));

drop policy if exists "admins insert inventory_log" on public.inventory_log;
create policy "admins insert inventory_log"
on public.inventory_log for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- time_entries — PATTERN B
-- Employees clock in/out for THEMSELVES; admins can do anything.
-- =============================================================================

drop policy if exists "members read own time_entries or admins all" on public.time_entries;
create policy "members read own time_entries or admins all"
on public.time_entries for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "employees insert own time_entries" on public.time_entries;
create policy "employees insert own time_entries"
on public.time_entries for insert
to authenticated
with check (
  organization_id in (select public.current_user_org_ids())
  and employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "employees update own open time_entries or admins all" on public.time_entries;
create policy "employees update own open time_entries or admins all"
on public.time_entries for update
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or (
    employee_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
)
with check (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
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
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- bonuses — PATTERN A (but employees can SELECT their own)
-- =============================================================================

drop policy if exists "members read own bonuses or admins all" on public.bonuses;
create policy "members read own bonuses or admins all"
on public.bonuses for select
to authenticated
using (
  public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
  or employee_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

drop policy if exists "admins insert bonuses" on public.bonuses;
create policy "admins insert bonuses"
on public.bonuses for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins update bonuses" on public.bonuses;
create policy "admins update bonuses"
on public.bonuses for update
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]))
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete bonuses" on public.bonuses;
create policy "admins delete bonuses"
on public.bonuses for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- =============================================================================
-- chat_threads / chat_thread_members / chat_messages — PATTERN C
-- =============================================================================

-- chat_threads
drop policy if exists "members read their threads" on public.chat_threads;
create policy "members read their threads"
on public.chat_threads for select
to authenticated
using (
  organization_id in (select public.current_user_org_ids())
  and id in (
    select thread_id from public.chat_thread_members
    where membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

drop policy if exists "admins insert chat_threads" on public.chat_threads;
create policy "admins insert chat_threads"
on public.chat_threads for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete chat_threads" on public.chat_threads;
create policy "admins delete chat_threads"
on public.chat_threads for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- chat_thread_members
drop policy if exists "members read thread members" on public.chat_thread_members;
create policy "members read thread members"
on public.chat_thread_members for select
to authenticated
using (
  organization_id in (select public.current_user_org_ids())
  and thread_id in (
    select thread_id from public.chat_thread_members m2
    where m2.membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

drop policy if exists "admins insert thread members" on public.chat_thread_members;
create policy "admins insert thread members"
on public.chat_thread_members for insert
to authenticated
with check (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "admins delete thread members" on public.chat_thread_members;
create policy "admins delete thread members"
on public.chat_thread_members for delete
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

-- chat_messages
drop policy if exists "thread members read messages" on public.chat_messages;
create policy "thread members read messages"
on public.chat_messages for select
to authenticated
using (
  thread_id in (
    select thread_id from public.chat_thread_members
    where membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
);

drop policy if exists "thread members insert messages" on public.chat_messages;
create policy "thread members insert messages"
on public.chat_messages for insert
to authenticated
with check (
  thread_id in (
    select thread_id from public.chat_thread_members
    where membership_id in (
      select id from public.memberships
      where profile_id = auth.uid() and status = 'active'
    )
  )
  and sender_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
);

-- No UPDATE policy — messages are immutable.
drop policy if exists "senders delete own messages" on public.chat_messages;
create policy "senders delete own messages"
on public.chat_messages for delete
to authenticated
using (
  sender_id in (
    select id from public.memberships
    where profile_id = auth.uid() and status = 'active'
  )
  or public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[])
);

-- =============================================================================
-- audit_log — PATTERN E (append-only)
-- =============================================================================

drop policy if exists "admins read audit_log" on public.audit_log;
create policy "admins read audit_log"
on public.audit_log for select
to authenticated
using (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

drop policy if exists "members insert audit_log" on public.audit_log;
create policy "members insert audit_log"
on public.audit_log for insert
to authenticated
with check (organization_id in (select public.current_user_org_ids()));

-- No UPDATE. No DELETE. Audit log is append-only.
