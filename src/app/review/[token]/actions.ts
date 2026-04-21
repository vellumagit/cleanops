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
 * Uses the admin client because the reviewer is the cleaning company's
 * end customer, who has no Sollos account. The capability is the
 * review_token on the invoice URL.
 */
export async function submitReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const token = formData.get("token") as string;
  const invoiceId = formData.get("invoiceId") as string;
  const rating = Number(formData.get("rating"));
  const comment = (formData.get("comment") as string)?.trim() || null;

  if (!token || !invoiceId) {
    return { success: false, error: "Invalid form data." };
  }

  if (!rating || rating < 1 || rating > 5) {
    return { success: false, error: "Please select a rating." };
  }

  const admin = createSupabaseAdminClient();

  // Verify the token matches the invoice.
  // review_token is not yet in generated types, so we fetch it separately.
  const { data: invoiceRow } = await admin
    .from("invoices")
    .select("id, organization_id, client_id, booking_id")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoiceRow) {
    return { success: false, error: "Invalid or expired review link." };
  }

  // Verify review_token matches (column not in generated types)
  const { data: tokenRow } = (await admin
    .from("invoices")
    .select("review_token" as never)
    .eq("id", invoiceId)
    .maybeSingle()) as unknown as { data: { review_token: string | null } | null };

  if (!tokenRow || tokenRow.review_token !== token) {
    return { success: false, error: "Invalid or expired review link." };
  }

  const invoice = invoiceRow;

  // Look up the assigned employee from the booking (if any)
  let employeeId: string | null = null;
  if (invoice.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("assigned_to")
      .eq("id", invoice.booking_id)
      .maybeSingle();
    employeeId = booking?.assigned_to ?? null;
  }

  // Check for duplicate review
  const { data: existing } = await admin
    .from("reviews")
    .select("id")
    .eq("organization_id", invoice.organization_id)
    .eq("client_id", invoice.client_id ?? "")
    .maybeSingle();

  if (existing) {
    return { success: false, error: "You've already submitted a review. Thank you!" };
  }

  // Insert the review
  const { data: inserted, error } = await admin
    .from("reviews")
    .insert({
      organization_id: invoice.organization_id,
      booking_id: invoice.booking_id,
      client_id: invoice.client_id,
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

  // Fetch client + employee names for the in-app notification / low-review alert
  const [{ data: client }, { data: emp }] = await Promise.all([
    invoice.client_id
      ? admin.from("clients").select("name").eq("id", invoice.client_id).maybeSingle() as unknown as Promise<{
          data: { name: string | null } | null;
        }>
      : Promise.resolve({ data: null as { name: string | null } | null }),
    employeeId
      ? admin.from("profiles").select("full_name").eq("id", employeeId).maybeSingle() as unknown as Promise<{
          data: { full_name: string | null } | null;
        }>
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
  ]);

  // Fire-and-forget: in-app notification + push + low-review email alert
  notifyReviewSubmitted(invoice.organization_id, {
    rating,
    clientName: client?.name ?? "A client",
    employeeName: emp?.full_name ?? null,
    reviewId: inserted.id,
    reviewText: comment,
  });

  return { success: true, error: null };
}
