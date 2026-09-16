-- A new workspace sends nothing until a human enables it.
--
-- Three spam signups in four days (daoSHOP 9/11, daoCS 9/13, PakkeDao 9/14),
-- the third one AFTER Turnstile, the week-one locks and the disposable-domain
-- refusal had all shipped. Those guards limit damage after entry; none of them
-- prevents entry, and none ever will — the actor uses a real browser and a
-- real outlook.com address, so there is nothing left to filter on.
--
-- So stop trying to keep them out and make being in worth nothing. The cap
-- already treats 0 as "sending off" (email.ts resolves it with ?? rather than
-- ||, so a zero survives instead of falling through to the age-based default).
-- Defaulting the column to 0 means a fresh signup cannot mail anyone until
-- someone raises it, and signing up again grants exactly the same nothing.
--
-- This touches NEW rows only. Every existing org keeps its current value —
-- NULL for all of them today, which still resolves to 50/day under a week
-- old and 500/day after. Svit and the rest are unaffected.
--
-- Raising a cap for an approved workspace:
--   update public.organizations set email_daily_cap = null where id = '...';
-- NULL restores the normal age-based default; a number pins a specific cap.

alter table public.organizations
  alter column email_daily_cap set default 0;

comment on column public.organizations.email_daily_cap is
  'Outbound email cap per day. 0 = sending off, and the default for new '
  'workspaces so a fresh signup cannot mail anyone until a human approves it. '
  'NULL = age-based default (50/day under a week old, 500/day after). '
  'Any other number pins that cap.';

notify pgrst, 'reload schema';
