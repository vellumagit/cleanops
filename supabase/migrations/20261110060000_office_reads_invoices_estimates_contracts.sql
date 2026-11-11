-- =============================================================================
-- Invoices, estimates and contracts are for the office, not the whole crew
-- =============================================================================
-- Each of these tables had one read policy, "members read ...": any active
-- member of the company could read every row through the API. Every row
-- carries public_token, the link the client is sent, and the link is the
-- whole capability. With it a cleaner could open a client's invoice, accept
-- an estimate on the client's behalf (which can book the job), or sign a
-- contract as the client. (Security audit Batch B; review links were the
-- money-to-the-member case and were fixed in 20261110050000.)
--
-- Nothing a cleaner uses reads these tables. The field app never does, and
-- the office app only admits owners, admins and managers. Writes were
-- already limited to them. Reads now match, by the same rule the write
-- policies use. A client keeps reading their own invoices through the
-- portal ("clients_read_own_invoices", untouched), and the public link pages
-- read through the service role, so links in clients' inboxes are unchanged.
--
-- Managers can still read the links. They can already send these documents
-- and act on them in the app, so that is within what they are trusted with.
--
-- Safe to run before or after the push; no code depends on it. Re-runnable.
-- =============================================================================

drop policy if exists "members read invoices" on public.invoices;
drop policy if exists "office reads invoices" on public.invoices;
create policy "office reads invoices"
  on public.invoices
  for select
  to authenticated
  using (
    public.current_user_has_role(
      organization_id,
      array['owner', 'admin', 'manager']::public.membership_role[]
    )
  );

drop policy if exists "members read estimates" on public.estimates;
drop policy if exists "office reads estimates" on public.estimates;
create policy "office reads estimates"
  on public.estimates
  for select
  to authenticated
  using (
    public.current_user_has_role(
      organization_id,
      array['owner', 'admin', 'manager']::public.membership_role[]
    )
  );

drop policy if exists "members read contracts" on public.contracts;
drop policy if exists "office reads contracts" on public.contracts;
create policy "office reads contracts"
  on public.contracts
  for select
  to authenticated
  using (
    public.current_user_has_role(
      organization_id,
      array['owner', 'admin', 'manager']::public.membership_role[]
    )
  );
