-- =============================================================================
-- Clients: preferred cleaner
-- =============================================================================
-- Lots of cleaning clients prefer the same cleaner every visit (trust,
-- routine, the cleaner knows where the hidden key is). Storing the
-- preference on the client row lets us auto-fill the assignee on new
-- bookings for that client instead of the owner remembering / looking
-- up past jobs every time.
--
-- ON DELETE SET NULL because deactivating / removing a cleaner
-- shouldn't orphan the client row. Owner picks a new preferred cleaner
-- when they reassign.
-- =============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS preferred_cleaner_id uuid
    REFERENCES public.memberships(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clients_preferred_cleaner_id_idx
  ON public.clients (preferred_cleaner_id)
  WHERE preferred_cleaner_id IS NOT NULL;

COMMENT ON COLUMN public.clients.preferred_cleaner_id IS
  'Default cleaner for new bookings on this client. Auto-fills the primary assignee on /app/bookings/new when a client is picked. Nullable — skip to let the owner pick per booking.';
