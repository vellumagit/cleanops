-- Add a proper estimate_id FK to bookings so the estimate→booking link
-- is a real database relationship instead of a fragile notes-based tag.

alter table public.bookings
  add column if not exists estimate_id uuid references public.estimates(id) on delete set null;

create index if not exists bookings_estimate_id_idx
  on public.bookings (estimate_id);

comment on column public.bookings.estimate_id
  is 'The estimate this booking was auto-created from (null if booked directly).';
