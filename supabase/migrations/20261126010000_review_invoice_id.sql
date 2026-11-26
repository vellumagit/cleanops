-- Which invoice a review came from (src/lib/review-dedup.ts).
--
-- 2026-11-26: reviews are kept one per visit, no longer one per client
-- ever. An invoice that isn't for one visit (a period or monthly invoice)
-- has no visit to count by, so a review left from its link records the
-- invoice instead, and that invoice takes one review.
--
-- Nullable; nothing existing changes. Run before deploying the code that
-- writes it: until then a review from an invoice link fails to save.

alter table public.reviews
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists reviews_invoice_id_idx on public.reviews (invoice_id);

comment on column public.reviews.invoice_id is
  'The invoice whose review link this review came from, if any. An invoice with no visit takes one review, counted by this. Reviews from a visit''s link are counted by booking_id.';
