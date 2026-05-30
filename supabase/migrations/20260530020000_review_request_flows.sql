-- Two-track review-request system.
--
-- Until now we sent ONE email 24h after job completion that combined
-- (a) "How was the cleaning?" with (b) "Mind sharing on Google?". This
-- splits them into two distinct tracks with two distinct schedules:
--
--   Internal review     — emailed 2h after EVERY completed job, lands
--                         in the existing `reviews` table.
--   Google review ask   — emailed 24h after the customer's FIRST
--                         completed job, then monthly reminders while
--                         their state is `pending`, capped at 5
--                         reminders total. State lives on the client
--                         row, NOT per-booking.
--
-- The Google review "click" is the stop signal — when the customer
-- clicks the redirect URL in any of these emails, we mark the click
-- and the state moves to `clicked`, no more emails ever. We can't
-- actually confirm they wrote a review (the GBP API has its own
-- approval gate), but click == done for this iteration.

-- ---------------------------------------------------------------------------
-- 1. Per-client Google-review state
-- ---------------------------------------------------------------------------
--
-- State machine:
--   never_asked  → initial state (nothing sent yet)
--   pending      → initial ask sent, awaiting reminder cycle
--   clicked      → customer clicked our redirect link; stop asking
--   reviewed     → owner manually marked as reviewed; stop asking
--   opted_out    → customer clicked unsubscribe link in any ask
--   lapsed       → hit max_reminders without click; stop asking
--                  (owner can manually re-enable from the client page)

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS gbp_review_state         text NOT NULL DEFAULT 'never_asked'
    CHECK (gbp_review_state IN ('never_asked','pending','clicked','reviewed','opted_out','lapsed')),
  ADD COLUMN IF NOT EXISTS gbp_first_asked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS gbp_last_asked_at        timestamptz,
  ADD COLUMN IF NOT EXISTS gbp_next_reminder_at     timestamptz,
  ADD COLUMN IF NOT EXISTS gbp_clicked_at           timestamptz,
  ADD COLUMN IF NOT EXISTS gbp_unsubscribed_at      timestamptz,
  -- Reminder counter — we stamp the initial ask as 0 and increment
  -- each reminder. Capped against organizations.gbp_review_max_reminders.
  ADD COLUMN IF NOT EXISTS gbp_reminders_sent       integer NOT NULL DEFAULT 0,
  -- The click-tracking token used by /r/g/<token>. NULL until first
  -- ask is dispatched (cron mints lazily so we don't pre-allocate
  -- tokens for clients we never email).
  ADD COLUMN IF NOT EXISTS gbp_redirect_token       text UNIQUE,
  -- Separate unsubscribe token so revealing the redirect token in
  -- analytics doesn't leak the opt-out capability.
  ADD COLUMN IF NOT EXISTS gbp_unsubscribe_token    text UNIQUE,
  -- Optional: marker set when the client was added with "already
  -- reviewed us" checked. Captured for audit; the actual stop signal
  -- is gbp_review_state = 'reviewed'.
  ADD COLUMN IF NOT EXISTS gbp_marked_reviewed_at_creation boolean NOT NULL DEFAULT false;

-- Cron lookup index. Daily cron filters on (state, gbp_next_reminder_at)
-- so this partial index keeps the scan tiny even at 100k clients.
CREATE INDEX IF NOT EXISTS clients_gbp_reminder_due_idx
  ON public.clients (gbp_next_reminder_at)
  WHERE gbp_review_state = 'pending';

CREATE INDEX IF NOT EXISTS clients_gbp_state_idx
  ON public.clients (organization_id, gbp_review_state);

-- ---------------------------------------------------------------------------
-- 2. Per-org review-request automation tuning
-- ---------------------------------------------------------------------------
--
-- The existing per-org `automation_settings` JSONB blob handles the
-- on/off toggle for both tracks via existing keys. These two columns
-- are the timing knobs — kept as real columns (not JSON) because the
-- cron filters on them.

ALTER TABLE public.organizations
  -- How soon after a job is completed do we email the internal review
  -- request? Default 120 min (2h) per product decision. Range 30..1440.
  ADD COLUMN IF NOT EXISTS internal_review_delay_minutes integer NOT NULL DEFAULT 120
    CHECK (internal_review_delay_minutes BETWEEN 30 AND 1440),
  -- Days between Google-review reminder emails. Default 30, range 7..180.
  ADD COLUMN IF NOT EXISTS gbp_review_reminder_days      integer NOT NULL DEFAULT 30
    CHECK (gbp_review_reminder_days BETWEEN 7 AND 180),
  -- Max total reminders (excluding the initial ask). Default 5 per
  -- product decision. 0 = no reminders, just the initial. Cap at 24
  -- to prevent runaway monthly mail.
  ADD COLUMN IF NOT EXISTS gbp_review_max_reminders      integer NOT NULL DEFAULT 5
    CHECK (gbp_review_max_reminders BETWEEN 0 AND 24);

-- ---------------------------------------------------------------------------
-- 3. Track which booking triggered the Google-review ask (for unsub email)
-- ---------------------------------------------------------------------------
--
-- When we send the initial ask we want the email to reference "your
-- recent clean" so the customer knows what we're talking about. The
-- cron stamps this when the initial ask fires so reminders can still
-- show a meaningful "your most recent clean was on X" date.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS gbp_first_triggering_booking_id
    uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
