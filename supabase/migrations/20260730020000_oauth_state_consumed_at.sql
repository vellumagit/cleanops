-- OAuth state tokens: mark consumed instead of deleting.
--
-- The Sage and QuickBooks callbacks DELETED the single-use state row on
-- success. When the same callback URL is requested twice in one flow (browser
-- or extension prefetch, a refresh, back-navigation), the second request finds
-- no row and is indistinguishable from a forged callback — so the user is sent
-- to "Invalid or expired session" for a connection that actually succeeded.
-- That is exactly what happened on the first real Sage connect (2026-07-29:
-- tokens stored at 16:24:08 UTC, error shown to the user).
--
-- Keeping the row with a consumed_at stamp lets the callback tell "our own
-- state, already used" apart from "never issued this", and report the truth
-- without re-exchanging the authorization code (which the provider rejects
-- anyway — codes are single-use too).
--
-- consumed_at also makes the claim atomic: the callback updates
-- WHERE consumed_at IS NULL, so two callbacks racing in parallel can't both
-- win. The delete-based version had no equivalent guard.

ALTER TABLE public.sage_oauth_states
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

ALTER TABLE public.quickbooks_oauth_states
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

-- Rows now outlive consumption, so the daily cleanup cron prunes them by age.
CREATE INDEX IF NOT EXISTS sage_oauth_states_created_at_idx
  ON public.sage_oauth_states (created_at);

CREATE INDEX IF NOT EXISTS quickbooks_oauth_states_created_at_idx
  ON public.quickbooks_oauth_states (created_at);

NOTIFY pgrst, 'reload schema';
