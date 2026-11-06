-- One message per fact.
--
-- A notification can now say what it is ABOUT: notifications.fact, a key for
-- the (event, job) it reports — "no_clock_in:<booking>", "assigned:<booking>:
-- <start>", the Needs-you item's own key. The unique index below makes a
-- second row for the same fact to the same person impossible, so a sender
-- that runs twice (a retried cron tick, two code paths reaching the same
-- conclusion, a stamp whose write failed) can't message anyone twice about one
-- job. notify() inserts with ON CONFLICT DO NOTHING and pushes or emails only
-- the people whose row went in. Rows with no fact (fact IS NULL) are untouched:
-- NULLs are distinct in a unique index, so they dedupe nothing, exactly as
-- before. Likewise org-wide rows (recipient NULL) are not deduped.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS fact text;

COMMENT ON COLUMN public.notifications.fact IS
  'What this message is about — one key per (event, job). With the unique index, one person is told one fact once. NULL = not deduped.';

CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_fact_per_person
  ON public.notifications (organization_id, recipient_membership_id, fact);
