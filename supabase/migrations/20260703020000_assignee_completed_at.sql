-- Per-segment completion for split shifts. A split shift is a hand-off between
-- people (A works the first window, B the second); previously the first cleaner
-- tapping "Complete" ended the whole booking and billed the full duration
-- before the later segments were worked. Tracking completion per assignee lets
-- the booking finish (and invoice) only once EVERY segment is done.
alter table public.booking_assignees
  add column if not exists completed_at timestamptz;
