-- Add archived_at to clients so the existing soft-delete-aware queries
-- (booking/invoice/contract dropdowns + clients list + billing-cycle cron)
-- can filter archived clients out without throwing.
--
-- Stage 10 of the audit-driven bug fixes added `is("archived_at", null)`
-- to every client-fetching query under the assumption that the column
-- already existed (the audit incorrectly claimed it did). It didn't.
-- Every one of those queries was throwing the moment it ran.
--
-- archived_at NULL = active client (default). Setting it to a timestamp
-- archives the client — they keep all historical bookings/invoices but
-- stop appearing in dropdowns and lists. A future UI change will expose
-- an "Archive" button; for now this migration just unblocks the
-- soft-delete-aware queries that were assuming the column exists.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Index so the (archived_at IS NULL) filter is fast on large client lists.
CREATE INDEX IF NOT EXISTS clients_archived_at_idx
  ON public.clients (archived_at)
  WHERE archived_at IS NULL;
