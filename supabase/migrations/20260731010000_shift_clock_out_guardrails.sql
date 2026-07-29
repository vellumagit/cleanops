-- Forgotten clock-outs: reminders, auto-close, and a review flag.
--
-- Live data showed 3 entries (68.45h, 44.67h, 19.55h) making up 25.7% of one
-- org's entire recorded hours — all of them shifts someone forgot to close.
-- Nothing in the system reminded them, capped it, or flagged it afterwards.
--
-- Deliberately NOT adding a CHECK constraint on duration: the employee
-- clock-out path must always succeed, or a cleaner ends up stuck in a
-- permanently-open shift with no way out. We close the shift and flag it
-- instead, and a human decides what the hours really were.

alter table public.time_entries
  -- Set when the system closed the shift, or when its length is implausible.
  -- The owner resolves it from the timesheet; never auto-corrected.
  add column if not exists needs_review boolean not null default false,
  -- When the auto-close cron closed it (null = a human closed it).
  add column if not exists auto_closed_at timestamptz,
  -- Reminder bookkeeping, so a 30-minute cron doesn't re-nag every run.
  add column if not exists last_reminder_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

-- The review queue: small, and read on every timesheet load.
create index if not exists time_entries_needs_review_idx
  on public.time_entries (organization_id)
  where needs_review;

-- The reminder cron scans only OPEN entries; keep that scan cheap.
create index if not exists time_entries_open_reminder_idx
  on public.time_entries (clock_in_at)
  where clock_out_at is null;

comment on column public.time_entries.needs_review is
  'System flagged this entry as implausible (auto-closed, or far over the scheduled job length). An owner/manager confirms or corrects the hours; the system never silently rewrites them.';
