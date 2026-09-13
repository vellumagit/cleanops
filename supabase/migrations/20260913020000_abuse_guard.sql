-- ============================================================
-- A workspace can be suspended, and abuse gets flagged
-- ============================================================
--
-- After the 2026-09-11 spam run (see 20260913010000). Three stamps on the
-- org: suspended_at closes every door (sign-in, sending, the API) with a
-- reason the person sees; abuse_flagged_at rate-limits the tripwire email
-- to support so a noisy hour is one message, not sixty.

alter table public.organizations
  add column if not exists suspended_at timestamptz,
  add column if not exists suspend_reason text,
  add column if not exists abuse_flagged_at timestamptz;

comment on column public.organizations.suspended_at is
  'When set, members cannot sign in to the workspace, nothing sends, and the API refuses. Set by the abuse tripwire past a hard line, or by support via the signed link in the tripwire email.';
comment on column public.organizations.suspend_reason is
  'Why — shown to the members on the suspended page.';
comment on column public.organizations.abuse_flagged_at is
  'Last time the tripwire emailed support about this workspace. One email per day at most.';

notify pgrst, 'reload schema';
