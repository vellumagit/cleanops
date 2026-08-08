-- =============================================================================
-- Engagement classification + membership payees for subcontractor pay
-- supabase/migrations/20260808010000_engagement_and_membership_payees.sql
-- =============================================================================
-- The product models two kinds of person; the real customer has three:
--
--   EMPLOYEE      roster (memberships), paid through EMPLOYEE PAY (payroll)
--   SUBCONTRACTOR roster (memberships), operationally identical to an employee
--                 (logs in, assigned shifts, clocks in) but paid through
--                 SUBCONTRACTOR PAY, never payroll
--   OUTSOURCING   bench (freelancer_contacts), no login, SMS offers they claim,
--                 also paid through SUBCONTRACTOR PAY
--
-- Two things are missing at the DB level and both are added here:
--   1. memberships has no column that says which of the first two a person is.
--   2. subcontractor_payouts / subcontractor_bills can ONLY point at a bench
--      contact (contact_id NOT NULL -> freelancer_contacts), so a roster
--      subcontractor's payment or invoice is rejected by the database.
--
-- This migration is behaviour-neutral on its own. engagement defaults to
-- 'employee', so every existing person stays exactly where they are today
-- (payroll), and the new payee columns are null on every existing row.
-- Nobody moves until someone is explicitly flipped, which is a separate,
-- deliberate data step AFTER the application code ships.
-- =============================================================================


-- -- 1. memberships.engagement --------------------------------------------------
-- Mirrors the shape of the pay_type column added in 20260413040000.

alter table public.memberships
  add column if not exists engagement text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memberships_engagement_check'
      and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_engagement_check
        check (engagement in ('employee', 'subcontractor'));
  end if;
end $$;

create index if not exists memberships_org_engagement_idx
  on public.memberships (organization_id, engagement);

COMMENT ON COLUMN public.memberships.engagement IS
  'TAX / PAY classification of a roster person: employee => paid through payroll (EMPLOYEE PAY); subcontractor => paid through SUBCONTRACTOR PAY (subcontractor_payouts / subcontractor_bills), never through a payroll run. ORTHOGONAL to two columns it is constantly confused with: `role` is PERMISSIONS (owner|admin|manager|employee) and `pay_type` is the RATE BASIS (hourly|flat|percent). A subcontractor can hold role=manager; an employee can be pay_type=flat. Defaults to employee so existing orgs keep behaving exactly as before. Distinct again from freelancer_contacts, which is OUTSOURCING: external, no login, SMS shift offers.';


-- -- 1b. invitations.engagement ------------------------------------------------
-- An invited person's membership does not exist until they accept, so the
-- choice made when the invite was sent has to be parked somewhere until then.
-- Without this column the invite dialog can offer the choice but the membership
-- is created as an employee regardless, and a subcontractor silently appears in
-- the next payroll run. Read at both acceptance sites:
--   src/app/join/[token]/actions.ts
--   src/app/(marketing)/signup/actions.ts

alter table public.invitations
  add column if not exists engagement text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invitations_engagement_check'
      and conrelid = 'public.invitations'::regclass
  ) then
    alter table public.invitations
      add constraint invitations_engagement_check
        check (engagement in ('employee', 'subcontractor'));
  end if;
end $$;

COMMENT ON COLUMN public.invitations.engagement IS
  'Engagement to stamp on the membership when this invite is accepted. Same domain as memberships.engagement. Pending invitations created before this column existed default to employee, which is what they would have produced anyway.';


-- -- 2. Composite unique key so payables can FK on (id, organization_id) --------
-- The existing unique on memberships is (organization_id, profile_id), which
-- cannot back a composite FK. Without this, nothing at the DB level stops a
-- membership from org A being written into a payables row belonging to org B.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memberships_id_org_key'
      and conrelid = 'public.memberships'::regclass
  ) then
    alter table public.memberships
      add constraint memberships_id_org_key unique (id, organization_id);
  end if;
end $$;


-- -- 3. subcontractor_payouts: allow a membership payee -------------------------

alter table public.subcontractor_payouts
  alter column contact_id drop not null;

alter table public.subcontractor_payouts
  add column if not exists membership_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subcontractor_payouts_membership_org_fk'
      and conrelid = 'public.subcontractor_payouts'::regclass
  ) then
    -- Composite FK: the membership must belong to the SAME org as the payout.
    --
    -- Deliberately NO ACTION (the default), not RESTRICT. Both raise 23503
    -- when someone tries to hard-delete a membership that has payment history
    -- (which is the protection we want, and which the existing catches in
    -- src/app/app/employees/actions.ts:560 and :824 already surface as a
    -- friendly message). The difference is that NO ACTION is checked at END OF
    -- STATEMENT while RESTRICT is checked immediately. Deleting an organization
    -- cascades to BOTH memberships and subcontractor_payouts in one statement;
    -- RESTRICT would fire on the membership cascade before the payout cascade
    -- had run and abort the org delete (see the org-creation rollback at
    -- src/app/(marketing)/signup/actions.ts:192). NO ACTION lets that statement
    -- finish while still blocking a bare membership delete.
    alter table public.subcontractor_payouts
      add constraint subcontractor_payouts_membership_org_fk
        foreign key (membership_id, organization_id)
        references public.memberships (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subcontractor_payouts_one_payee'
      and conrelid = 'public.subcontractor_payouts'::regclass
  ) then
    -- Exactly one payee: a bench contact OR a roster membership, never both,
    -- never neither. num_nonnulls is the precise predicate for that, and every
    -- existing row already has contact_id set and membership_id null, so this
    -- validates instantly with no backfill.
    alter table public.subcontractor_payouts
      add constraint subcontractor_payouts_one_payee
        check (num_nonnulls(contact_id, membership_id) = 1);
  end if;
end $$;

create index if not exists subcontractor_payouts_membership_idx
  on public.subcontractor_payouts (membership_id);


-- -- 4. subcontractor_bills: identical shape -----------------------------------
-- Kept structurally identical to payouts on purpose: every read in
-- src/lib/subcontractor-payables.ts treats the two tables as parallel and
-- branches on the same discriminator.

alter table public.subcontractor_bills
  alter column contact_id drop not null;

alter table public.subcontractor_bills
  add column if not exists membership_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subcontractor_bills_membership_org_fk'
      and conrelid = 'public.subcontractor_bills'::regclass
  ) then
    alter table public.subcontractor_bills
      add constraint subcontractor_bills_membership_org_fk
        foreign key (membership_id, organization_id)
        references public.memberships (id, organization_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subcontractor_bills_one_payee'
      and conrelid = 'public.subcontractor_bills'::regclass
  ) then
    alter table public.subcontractor_bills
      add constraint subcontractor_bills_one_payee
        check (num_nonnulls(contact_id, membership_id) = 1);
  end if;
end $$;

create index if not exists subcontractor_bills_membership_idx
  on public.subcontractor_bills (membership_id);


-- -- 5. Notes on RLS (no policy changes needed) --------------------------------
-- The two SELECT policies from 20260716030000 key only off organization_id
-- plus the caller's own membership role/status -- contact_id never appears in
-- either predicate. Rows carrying a membership payee are therefore covered
-- identically and no policy is rewritten here.
--
-- FORCE RLS is applied dynamically by 20260720020000_force_rls_all_tenant_tables
-- and both tables were caught by that loop; adding a column does not disturb
-- relforcerowsecurity. service_role has BYPASSRLS and is unaffected.
--
-- There is intentionally no INSERT/UPDATE/DELETE policy on either table: all
-- reads and writes go through the service-role client
-- (src/lib/subcontractor-payables.ts, src/app/app/freelancers/payables/actions.ts),
-- so these policies are defense-in-depth against direct PostgREST access, NOT
-- the app's access gate. The gate is requireMembership(['owner','admin','manager'])
-- in the pages/route and ownerAdmin() (owner/admin only) in the actions.
--
-- Consequence worth knowing: `role` is orthogonal to `engagement`. A roster
-- subcontractor holding role owner/admin/manager passes both the RLS predicate
-- and the app-level gate, and would see every payee's payables org-wide. If
-- that is unacceptable, fix it in the app-level gate, not in these policies.

COMMENT ON COLUMN public.subcontractor_payouts.membership_id IS
  'Roster payee: a membership whose engagement = subcontractor. Exactly one of contact_id (bench / outsourcing contact) and membership_id is set, enforced by subcontractor_payouts_one_payee.';
COMMENT ON COLUMN public.subcontractor_bills.membership_id IS
  'Roster payee: a membership whose engagement = subcontractor. Exactly one of contact_id (bench / outsourcing contact) and membership_id is set, enforced by subcontractor_bills_one_payee.';

notify pgrst, 'reload schema';