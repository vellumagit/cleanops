-- Soft-delete window for organizations.
--
-- When an owner clicks "Delete my organization" we set
-- `deletion_scheduled_at` to now + 30 days. A nightly cron hard-purges
-- orgs whose window has elapsed. Within the window, the owner can cancel
-- (sets column back to NULL) with no data loss.
--
-- `deleted_at` is only set at the moment of final hard-delete, after data
-- has been wiped. It stays on the row so we don't silently re-create the
-- same org id by accident; the row is a tombstone.
--
-- Idempotent — safe to re-run.

alter table public.organizations
  add column if not exists deletion_scheduled_at timestamptz,
  add column if not exists deleted_at            timestamptz;

comment on column public.organizations.deletion_scheduled_at is
  'Timestamp at which this org is scheduled for permanent deletion. NULL = not scheduled. Owner can clear this within the grace window to abort.';

comment on column public.organizations.deleted_at is
  'Timestamp at which this org was hard-deleted by the purge cron. The row remains as a tombstone to prevent id reuse.';

-- Partial index for the purge cron: only scheduled, not-yet-deleted orgs.
create index if not exists organizations_deletion_pending_idx
  on public.organizations (deletion_scheduled_at)
  where deletion_scheduled_at is not null and deleted_at is null;
