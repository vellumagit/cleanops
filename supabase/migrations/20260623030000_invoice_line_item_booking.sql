-- Link a line item back to the booking it bills, so consolidated
-- "Bill for a period" invoices can carry many bookings and we can tell
-- which bookings have already been invoiced (avoiding double-billing).
alter table public.invoice_line_items
  add column if not exists booking_id uuid
    references public.bookings(id) on delete set null;

create index if not exists invoice_line_items_booking_idx
  on public.invoice_line_items (booking_id);
