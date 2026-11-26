import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Has this already been reviewed? One review per visit (2026-11-26).
 *
 * Until then the review page kept one review per client, ever, while
 * everything around it was built for one per visit: the internal review
 * request is sent after every completed job (at most as often as the
 * company's cadence), the client portal offers "Leave a review" on every
 * finished visit and shows each visit's own stars, and the per-employee
 * scores and bonus rules count reviews per cleaner. So a weekly client's
 * second visit, with a different cleaner, could never be reviewed, and the
 * link said "You've already submitted a review" (fix-later #100).
 *
 * The review page and its save both ask this, so what the page shows and
 * what the save accepts are the same rule:
 *
 *   - a review tied to a visit: one per visit, however the client got there
 *     (the booking's link, its invoice's link, the portal);
 *   - an invoice with no visit (a period or monthly invoice): one per
 *     invoice, by reviews.invoice_id (migration 20261126010000).
 *
 * `limit(1)`, never `maybeSingle()`: a visit can hold more than one review
 * when the office adds one by hand, and `maybeSingle()` on two rows returns
 * an error and no data, which would read as "not reviewed".
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type ExistingReview = { id: string; rating: number; comment: string | null };

export type ReviewSubject = {
  organizationId: string;
  bookingId: string | null;
  /** The invoice whose link this is; counts only when there is no visit. */
  invoiceId: string | null;
};

export async function existingReview(admin: Admin, s: ReviewSubject): Promise<ExistingReview | null> {
  let query = admin.from("reviews").select("id, rating, comment").eq("organization_id", s.organizationId);
  if (s.bookingId) query = query.eq("booking_id", s.bookingId);
  else if (s.invoiceId) query = query.eq("invoice_id" as never, s.invoiceId as never);
  else return null;
  const { data, error } = (await query.order("submitted_at", { ascending: false }).limit(1)) as unknown as {
    data: ExistingReview[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`reading reviews: ${error.message}`);
  return data?.[0] ?? null;
}
