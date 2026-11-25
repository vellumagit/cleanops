-- Quiet mode: a company that sends nothing at all (src/lib/quiet-mode.ts).
--
-- 2026-11-24: the Velluma demo account had its automations switched off and
-- its owner had muted every notice, and it still emailed "Fatima hasn't
-- clocked in" to five office accounts. This one switch is read where every
-- email, text and phone alert leaves, so nothing slips past it. The work
-- itself carries on, and the bell inside the app still lists every notice.
--
-- Off for everyone; nothing changes until someone turns it on.

alter table public.organizations
  add column if not exists quiet_mode boolean not null default false;

comment on column public.organizations.quiet_mode is
  'When true, nothing is sent for this company: no email, text or phone alert, to anyone. The work goes on and the in-app bell still records notices. Settings, Client messages.';
