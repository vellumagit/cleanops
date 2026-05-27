"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyReviewSubmitted } from "@/lib/automations";

type ReviewState = {
  success: boolean;
  error: string | null;
};

/**
 * Submit a public review — no login required.
 *
 * Handles two token sources:
 *   source="booking"  — token is on bookings.review_token (post-completion path)
 *   source="invoice"  — token is on invoices.review_token (invoice paid path)
 *
 * Either way the capability check is: token must match the row identified by
 * sourceId. Dedup is per-client per-org (a client leaves at most one review
 * regardless of how many tokens they receive).
 */
export async function submitReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const token = String(formData.get("token") ?? "").trim();
  const source = String(formData.get("source") ?? "") as "booking" | "invoice";
  const sourceId = String(formData.get("sourceId") ?? "").trim();
  const rating = Number(formData.get("rating"));
  const comment = (formData.get("comment") as string)?.trim() || null;

  if (!token || !sourceId || !["booking", "invoice"].includes(source)) {
    return { success: false, error: "Invalid form data." };
  }
  if (!rating || rating < 1 || rating > 5) {
    return { success: false, error: "Please select a rating." };
  }

  const admin = createSupabaseAdminClient();

  // ── Resolve org / client / booking from the appropriate source ────────────

  let organizationId: string;
  let clientId: string | null;
  let bookingId: string | null;
  let employeeId: string | null = null;

  // Tokens expire after this window has elapsed since the underlying
  // event (booking date for booking-source; invoice paid_at for
  // invoice-source). Without expiry, leaked/screenshotted review links
  // could be used years later — and reviews feed bonus calculation, so
  // a vindictive ex-employee with old emails can manipulate payroll.
  const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
  const tooOld = (refIso: string | null): boolean => {
    if (!refIso) return false;
    return Date.now() - new Date(refIso).getTime() > TOKEN_TTL_MS;
  };

  if (source === "booking") {
    // Verify the token against bookings.review_token
    const { data: booking } = (await admin
      .from("bookings")
      .select("id, organization_id, client_id, assigned_to, review_token, scheduled_at")
      .eq("id", sourceId)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        organization_id: string;
        client_id: string | null;
        assigned_to: string | null;
        review_token: string | null;
        scheduled_at: string | null;
      } | null;
    };

    if (!booking || booking.review_token !== token) {
      return { success: false, error: "Invalid or expired review link." };
    }
    if (tooOld(booking.scheduled_at)) {
      return { success: false, error: "This review link has expired." };
    }

    organizationId = booking.organization_id;
    clientId = booking.client_id;
    bookingId = booking.id;
    employeeId = booking.assigned_to;
  } else {
    // source === "invoice" — legacy path, keep existing verification logic
    const { data: invoiceRow } = await admin
      .from("invoices")
      .select("id, organization_id, client_id, booking_id, paid_at, created_at")
      .eq("id", sourceId)
      .maybeSingle();

    if (!invoiceRow) {
      return { success: false, error: "Invalid or expired review link." };
    }

    const { data: tokenRow } = (await admin
      .from("invoices")
      .select("review_token" as never)
      .eq("id", sourceId)
      .maybeSingle()) as unknown as {
      data: { review_token: string | null } | null;
    };

    if (!tokenRow || tokenRow.review_token !== token) {
      return { success: false, error: "Invalid or expired review link." };
    }
    // Prefer paid_at as the anchor (invoice review tokens are minted
    // on payment). Fall back to created_at if paid_at is null.
    const invoiceWithDates = invoiceRow as unknown as {
      paid_at: string | null;
      created_at: string | null;
    };
    const anchor =
      invoiceWithDates.paid_at ?? invoiceWithDates.created_at;
    if (tooOld(anchor)) {
      return { success: false, error: "This review link has expired." };
    }

    organizationId = invoiceRow.organization_id;
    clientId = invoiceRow.client_id;
    bookingId = invoiceRow.booking_id;

    // Look up employee from the linked booking
    if (bookingId) {
      const { data: b } = await admin
        .from("bookings")
        .select("assigned_to")
        .eq("id", bookingId)
        .maybeSingle();
      employeeId = b?.assigned_to ?? null;
    }
  }

  // ── Dedup: one review per client per org ──────────────────────────────────
  // Skip dedup when clientId is null — the previous `.eq("client_id", "")`
  // searched for the empty-string literal which returns no rows and could
  // hit a unique-constraint violation on insert if multiple null-client
  // reviews exist for the same org. Better to allow the insert and let
  // the (rare) tokens-with-no-client through.
  let existing: { id: string } | null = null;
  if (clientId) {
    const { data } = await admin
      .from("reviews")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .maybeSingle();
    existing = (data as { id: string } | null) ?? null;
  }

  if (existing) {
    return {
      success: false,
      error: "You've already submitted a review. Thank you!",
    };
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: inserted, error } = await admin
    .from("reviews")
    .insert({
      organization_id: organizationId,
      booking_id: bookingId,
      client_id: clientId,
      employee_id: employeeId,
      rating,
      comment,
    })
    .select("id")
    .single() as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (error || !inserted) {
    console.error("[review] insert error:", error?.message);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // ── Fire-and-forget notifications ─────────────────────────────────────────
  const [{ data: client }, { data: emp }] = await Promise.all([
    clientId
      ? (admin
          .from("clients")
          .select("name")
          .eq("id", clientId)
          .maybeSingle() as unknown as Promise<{
          data: { name: string | null } | null;
        }>)
      : Promise.resolve({ data: null as { name: string | null } | null }),
    // employeeId is a memberships.id, NOT a profiles.id. Previously this
    // queried profiles directly, which always returned null because the
    // two id spaces don't overlap. Notification emails consequently said
    // "A review for null" for the credited employee. Join through
    // memberships → profiles to get the actual name. Falls back to
    // display_name for shadow members (no linked profile).
    employeeId
      ? (admin
          .from("memberships")
          .select("display_name, profile:profiles ( full_name )")
          .eq("id", employeeId)
          .maybeSingle() as unknown as Promise<{
          data: {
            display_name: string | null;
            profile: { full_name: string | null } | null;
          } | null;
        }>)
      : Promise.resolve({
          data: null as {
            display_name: string | null;
            profile: { full_name: string | null } | null;
          } | null,
        }),
  ]);

  notifyReviewSubmitted(organizationId, {
    rating,
    clientName: client?.name ?? "A client",
    employeeName:
      emp?.profile?.full_name ?? emp?.display_name ?? null,
    reviewId: inserted.id,
    reviewText: comment,
  });

  return { success: true, error: null };
}
