-- A workspace that can't send should be able to reach you by trying.
--
-- New orgs now default to email_daily_cap = 0, so a real signup hits a wall
-- and may never say so — they just leave. The refusal names support@, but
-- that is a pull. This makes it a push: the first time a blocked workspace
-- tries to send, support hears about it.
--
-- Its own column rather than reusing abuse_flagged_at. That one throttles
-- "this looks like abuse"; this throttles "someone is waiting on you". A
-- workspace can plausibly be both at once, and one must not silence the
-- other — a spam org tripping the abuse flag should not also suppress the
-- approval request from a legitimate org, nor the reverse.

alter table public.organizations
  add column if not exists send_approval_requested_at timestamptz;

comment on column public.organizations.send_approval_requested_at is
  'Last time a zero-cap workspace tried to send and support was told. '
  'Throttles that notification to one a day. NULL = never asked.';

notify pgrst, 'reload schema';
