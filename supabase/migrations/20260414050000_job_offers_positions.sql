-- -----------------------------------------------------------------------------
-- Multi-position job offers
--
-- Adds positions_needed (how many freelancers the admin wants) and
-- positions_filled (how many have claimed so far) to job_offers.
-- The claim action increments positions_filled atomically and only
-- flips status → 'filled' when positions_filled = positions_needed.
-- -----------------------------------------------------------------------------

ALTER TABLE public.job_offers
  ADD COLUMN IF NOT EXISTS positions_needed  integer NOT NULL DEFAULT 1 CHECK (positions_needed >= 1),
  ADD COLUMN IF NOT EXISTS positions_filled  integer NOT NULL DEFAULT 0 CHECK (positions_filled >= 0);

-- For existing rows that are already 'filled', set positions_filled = 1.
UPDATE public.job_offers
SET positions_filled = 1
WHERE status = 'filled' AND positions_filled = 0;

-- The filled_contact_id column only tracked a single winner. For multi-position
-- offers we track winners via job_offer_claims instead. We keep filled_contact_id
-- for backward compat but it will hold the LAST claimer going forward.

-- -----------------------------------------------------------------------------
-- job_offer_claims — one row per successful claim
-- -----------------------------------------------------------------------------
-- When positions_needed > 1, multiple contacts can claim. Each successful
-- claim inserts a row here. This replaces the single filled_contact_id for
-- multi-position tracking while keeping that column as a denormalised pointer
-- to the most-recent (or only) claimer.

CREATE TABLE IF NOT EXISTS public.job_offer_claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  offer_id         uuid NOT NULL REFERENCES public.job_offers(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES public.freelancer_contacts(id) ON DELETE CASCADE,
  dispatch_id      uuid NOT NULL REFERENCES public.job_offer_dispatches(id) ON DELETE CASCADE,
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, contact_id)   -- same freelancer can't claim twice
);

CREATE INDEX IF NOT EXISTS job_offer_claims_offer_idx
  ON public.job_offer_claims (offer_id);

ALTER TABLE public.job_offer_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_offer_claims FORCE  ROW LEVEL SECURITY;

-- RLS: admins read/write within their org (same pattern as other bench tables)
CREATE POLICY "admins read job_offer_claims"
ON public.job_offer_claims FOR SELECT
TO authenticated
USING (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

CREATE POLICY "admins insert job_offer_claims"
ON public.job_offer_claims FOR INSERT
TO authenticated
WITH CHECK (public.current_user_has_role(organization_id, array['owner','admin']::public.membership_role[]));

COMMENT ON TABLE public.job_offer_claims IS 'One row per successful freelancer claim on a multi-position job offer.';
COMMENT ON COLUMN public.job_offers.positions_needed IS 'How many freelancers the admin needs for this shift.';
COMMENT ON COLUMN public.job_offers.positions_filled IS 'Denormalised counter — incremented atomically by the claim action.';
