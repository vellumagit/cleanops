-- An offer can be posted to REPLACE someone on the job ("Diana covers for
-- Olha"). When the offer is first claimed, the claimer takes that person's
-- crew row and they come off the job. See src/lib/offer-swap.ts.
--
-- Nullable: most offers fill an empty spot and replace nobody. SET NULL so
-- removing a member never deletes offer history.

alter table public.job_offers
  add column if not exists replaces_membership_id uuid
    references public.memberships(id) on delete set null;

comment on column public.job_offers.replaces_membership_id is
  'Who this offer covers for. The first claim swaps the claimer in for them on the booking (unless the job has started or they have clocked in).';
