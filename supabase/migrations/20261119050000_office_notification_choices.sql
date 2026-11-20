-- Each office person chooses which notices alert them.
--
-- WHY
-- The office is sent about forty different notices, every one to every
-- owner, admin and manager, as a phone alert. Asked for in person on
-- 2026-11-19: let each of them choose what reaches them. Cleaners get no
-- such choice; what they are sent, they need.
--
-- NOW
-- memberships.notification_prefs holds { "muted_topics": ["money", ...] }.
-- A muted topic stops the phone alert and the email for that person. The
-- bell inside the app still lists everything. Empty means "alert me about
-- everything", which is what everyone has today.
--
-- The topics and what belongs to each are in src/lib/notification-topics.ts.
--
-- Run BEFORE the code push: sending a notice reads this column.
-- Idempotent. Changes no existing rows' behaviour.

begin;

alter table public.memberships
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.memberships.notification_prefs is
  'This person''s notice choices: { muted_topics: [...] }. A muted topic sends no phone alert or email; the in-app bell still lists it. See src/lib/notification-topics.ts.';

commit;

notify pgrst, 'reload schema';
