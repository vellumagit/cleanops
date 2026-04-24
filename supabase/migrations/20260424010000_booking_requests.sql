-- =============================================================================
-- Client booking requests — portal self-service intake
-- =============================================================================
-- Clients logged into /client/* can submit a request for a new booking.
-- The owner reviews the request and creates the real booking in
-- /app/bookings/new after discussing scope / pricing with the client.
--
-- We don't let clients create bookings directly because:
--   - Pricing usually needs discussion (add-ons, duration, location)
--   - Availability conflicts need manual resolution
--   - The owner may want to approve / decline
--
-- Clients only see their own requests. Org members see everything in
-- their org.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.booking_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  service_type          text,
  preferred_date        date,
  preferred_time_window text,          -- 'morning' | 'afternoon' | 'evening' | 'flexible'
  address               text,
  notes                 text,

  status                text NOT NULL DEFAULT 'pending',  -- pending | scheduled | declined | cancelled
  booking_id            uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  responded_at          timestamptz,
  responded_by          uuid REFERENCES public.memberships(id) ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Drop and recreate constraints defensively in case the migration
-- is partially applied from a prior attempt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_status_check'
  ) THEN
    ALTER TABLE public.booking_requests
      ADD CONSTRAINT booking_requests_status_check
      CHECK (status IN ('pending', 'scheduled', 'declined', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_requests_time_window_check'
  ) THEN
    ALTER TABLE public.booking_requests
      ADD CONSTRAINT booking_requests_time_window_check
      CHECK (
        preferred_time_window IS NULL
        OR preferred_time_window IN ('morning', 'afternoon', 'evening', 'flexible')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS booking_requests_organization_id_idx
  ON public.booking_requests (organization_id);
CREATE INDEX IF NOT EXISTS booking_requests_client_id_idx
  ON public.booking_requests (client_id);
CREATE INDEX IF NOT EXISTS booking_requests_pending_idx
  ON public.booking_requests (organization_id, created_at DESC)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS booking_requests_set_updated_at ON public.booking_requests;
CREATE TRIGGER booking_requests_set_updated_at
BEFORE UPDATE ON public.booking_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

-- Org members read everything in their org. Writes (insert by client
-- portal, update by admin) go through server actions that use the
-- admin client, so no INSERT / UPDATE policies needed for authenticated.
DROP POLICY IF EXISTS "members read org booking_requests" ON public.booking_requests;
CREATE POLICY "members read org booking_requests"
ON public.booking_requests FOR SELECT
TO authenticated
USING (organization_id IN (SELECT public.current_user_org_ids()));

COMMENT ON TABLE public.booking_requests IS
  'Client-submitted booking requests from the /client portal. Owner converts to a real booking after review.';
COMMENT ON COLUMN public.booking_requests.booking_id IS
  'Populated when the owner creates a real booking from this request. Joins request → booking for traceability.';
