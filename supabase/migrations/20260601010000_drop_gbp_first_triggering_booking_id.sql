-- Drop the dead FK column from clients.
--
-- 20260530020000_review_request_flows.sql added
-- `gbp_first_triggering_booking_id` as a foreign key from
-- public.clients(gbp_first_triggering_booking_id) → public.bookings(id).
--
-- The intent was to let GBP reminder emails reference "your recent
-- clean was on X". That intent was never wired up: the column is
-- written by sendGbpReviewRequests() but never read by any email
-- template, page, or report. Confirmed dead in the post-ship audit.
--
-- The fatal side effect: PostgREST now sees TWO relationships
-- between bookings and clients (the normal bookings.client_id one,
-- plus this new one). Every `bookings.select("client:clients(...)")`
-- in the codebase started erroring with PGRST201:
--
--   "Could not embed because more than one relationship was found
--    for 'bookings' and 'clients'"
--
-- That broke ~60 query sites in the app fleet-wide — every page
-- rendering booking + client info. We caught it on /field/jobs
-- first because the diagnostic panel was wired there.
--
-- Fix: drop the column + its FK. Patching every embed with an
-- explicit !bookings_client_id_fkey hint would have been ~60 file
-- edits with ongoing maintenance cost; killing the dead column is
-- one statement and removes the failure class entirely.

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS gbp_first_triggering_booking_id;
