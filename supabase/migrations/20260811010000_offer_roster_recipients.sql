-- =============================================================================
-- Shift offers reach your own subcontractors, not just the on-call pool
-- supabase/migrations/20260811010000_offer_roster_recipients.sql
-- =============================================================================
-- The bench tables assumed every offer recipient is a freelancer_contacts row
-- — an off-platform stranger. Since 20260808 the roster distinguishes
-- employees from subcontractors (memberships.engagement), and an org's own
-- subcontractors are exactly the people an open shift should go to FIRST.
--
-- So dispatches and claims get a second, mutually-exclusive recipient type:
--
--   contact_id      an on-call cleaner (freelancer_contacts) — unchanged
--   membership_id   one of the org's own roster subcontractors
--
-- Exactly one is set per row, enforced by a CHECK. Nothing about the claim
-- mechanics changes: the SMS carries the same single-use token, the claim
-- page is still public, first tap still wins. What changes is what a claim
-- MEANS for a roster subcontractor: the claim action assigns them to the
-- booking (bookings.assigned_to / booking_assignees) — they are a
-- membership, so the assignment machinery, field tools, and clocked-hours
-- pay all apply exactly as if a manager had assigned them by hand.
--
-- Pay stays in one system per person (src/lib/engagement.ts): the offer's
-- flat pay_cents applies to on-call claims only; a roster subcontractor who
-- claims is paid from clocked hours like always. That is why
-- subcontractor-payables can keep ignoring claims that carry no contact_id.
-- =============================================================================


-- -- 1. job_offer_dispatches ----------------------------------------------------

alter table public.job_offer_dispatches
  alter column contact_id drop not null;

alter table public.job_offer_dispatches
  add column if not exists membership_id uuid
    references public.memberships (id) on delete cascade;

-- Exactly one recipient per dispatch. (contact_id was NOT NULL before, so no
-- existing row can violate this.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_offer_dispatches_one_recipient'
      and conrelid = 'public.job_offer_dispatches'::regclass
  ) then
    alter table public.job_offer_dispatches
      add constraint job_offer_dispatches_one_recipient
        check ((contact_id is null) <> (membership_id is null));
  end if;
end $$;

-- Same person can't be dispatched twice on one offer — mirrors the existing
-- unique (offer_id, contact_id). Partial, because membership_id is nullable.
create unique index if not exists job_offer_dispatches_offer_membership_key
  on public.job_offer_dispatches (offer_id, membership_id)
  where membership_id is not null;

create index if not exists job_offer_dispatches_membership_idx
  on public.job_offer_dispatches (membership_id)
  where membership_id is not null;


-- -- 2. job_offer_claims --------------------------------------------------------

alter table public.job_offer_claims
  alter column contact_id drop not null;

alter table public.job_offer_claims
  add column if not exists membership_id uuid
    references public.memberships (id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_offer_claims_one_recipient'
      and conrelid = 'public.job_offer_claims'::regclass
  ) then
    alter table public.job_offer_claims
      add constraint job_offer_claims_one_recipient
        check ((contact_id is null) <> (membership_id is null));
  end if;
end $$;

create unique index if not exists job_offer_claims_offer_membership_key
  on public.job_offer_claims (offer_id, membership_id)
  where membership_id is not null;


-- -- 3. job_offers.filled_membership_id -----------------------------------------
-- filled_contact_id is a denormalised pointer to the most recent claimer and
-- can only hold a freelancer contact. Its sibling for roster claims; the
-- claims table remains the source of truth for multi-position offers.

alter table public.job_offers
  add column if not exists filled_membership_id uuid
    references public.memberships (id);


-- -- 4. Comments ----------------------------------------------------------------

comment on column public.job_offer_dispatches.contact_id is
  'On-call recipient (freelancer_contacts). Exactly one of contact_id / membership_id is set.';
comment on column public.job_offer_dispatches.membership_id is
  'Roster-subcontractor recipient (memberships, engagement=subcontractor). Exactly one of contact_id / membership_id is set.';
comment on column public.job_offer_claims.membership_id is
  'Set when a roster subcontractor claimed. Such claims carry no flat pay — the claim action assigns the booking and pay flows from clocked hours.';
comment on column public.job_offers.filled_membership_id is
  'Denormalised pointer to the most recent roster-subcontractor claimer, sibling of filled_contact_id.';

notify pgrst, 'reload schema';
