-- Revert 20260915010000_new_orgs_send_nothing.sql.
--
-- Defaulting new workspaces to a zero email cap turned every signup into
-- something Brian had to manually approve before the product worked at all.
-- Called off the same day: the friction lands on real signups, who are the
-- ones you cannot afford to lose, while the spammer just signs up again and
-- waits — the approval queue is a cost to you and an inconvenience to them.
--
-- Forward migration rather than deleting the original, because the original
-- was already applied to production. History stays honest.
--
-- 0 still means "sending off" for a workspace deliberately set that way, and
-- withinOrgEmailCap still answers that case with its own sentence rather than
-- claiming a limit that resets at midnight. Only the default is reverted.

alter table public.organizations
  alter column email_daily_cap drop default;

comment on column public.organizations.email_daily_cap is
  'Override for the outbound email cap per day. NULL = default (50/day under '
  'a week old, 500/day after). 0 = sending off.';

notify pgrst, 'reload schema';
