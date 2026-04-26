-- =============================================================================
-- Booking-level review tokens + Google Review URL (Phase 17)
-- =============================================================================
-- Previously review tokens only existed on invoices (generated on invoice paid).
-- This migration decouples review requests from invoicing so we can:
--   1. Send a review request 24h after job completion regardless of invoice state.
--   2. Let clients leave reviews via their portal on any completed booking.
--
-- google_review_url on organizations closes the broken "Leave a Google Review"
-- button that existed but pointed to an empty placeid= URL.
-- =============================================================================

-- Booking-level review token (independent of invoicing)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS review_token text;

-- Unique so a token always resolves to exactly one booking.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_review_token_key'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_review_token_key UNIQUE (review_token);
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.review_token IS
  'Shared-secret token for the public /review/<token> page, generated
   when the 24-hour post-completion review request cron fires. NULL
   until the cron has run for this booking. Distinct from
   invoices.review_token — review requests can now be sent even when
   no invoice exists (cash jobs, Stripe-off-platform payments, etc.).';

-- Dedup stamp: set when the review request email is sent so the cron
-- never double-emails the same booking.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS review_request_sent_at timestamptz;

COMMENT ON COLUMN public.bookings.review_request_sent_at IS
  'Timestamp when the post-completion review request was emailed to the
   client. NULL = not yet sent. Set atomically with review_token so the
   cron never sends twice even if it runs during a partial batch.';

-- Fast lookup for the cron: "completed bookings without a review request yet"
CREATE INDEX IF NOT EXISTS bookings_review_request_pending_idx
  ON public.bookings (organization_id, status, review_request_sent_at)
  WHERE status = 'completed' AND review_request_sent_at IS NULL;

-- Org-level Google Business Profile review link.
-- Owners paste this from their Google Business Profile → Get more reviews → Share review link.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS google_review_url text;

COMMENT ON COLUMN public.organizations.google_review_url IS
  'Full URL to the org''s Google Business Profile write-a-review page.
   Shown as a CTA after a client submits a ≥4 star review on the
   platform review page (/review/<token>) and in the client portal.
   Example: https://g.page/r/xxxxxxxxxxxxxxxx/review';
