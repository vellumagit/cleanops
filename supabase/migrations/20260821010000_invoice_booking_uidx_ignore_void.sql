-- =============================================================================
-- A voided invoice shouldn't block the booking from being billed again
-- =============================================================================
-- invoices_booking_uidx enforces one invoice per booking — right, except it
-- counted VOIDED invoices. Void an invoice and try to re-invoice the same
-- booking (the normal correction flow, and exactly where the new void guard
-- steers people: undo the money, void, redo it right) and the insert hits
-- 23505 every time. The unique constraint should only bind among LIVE
-- invoices; a voided one is a tombstone, not a claim on the booking.

drop index if exists public.invoices_booking_uidx;
create unique index invoices_booking_uidx
  on public.invoices (booking_id)
  where booking_id is not null and voided_at is null;

notify pgrst, 'reload schema';
