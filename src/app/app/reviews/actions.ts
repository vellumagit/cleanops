"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { ReviewSchema } from "@/lib/validators/reviews";
import { notifyReviewSubmitted } from "@/lib/automations";

type Field = keyof typeof ReviewSchema.shape;
export type ReviewFormState = ActionState<Field>;

function readFormValues(formData: FormData) {
  return {
    booking_id: String(formData.get("booking_id") ?? ""),
    client_id: String(formData.get("client_id") ?? ""),
    employee_id: String(formData.get("employee_id") ?? ""),
    rating: String(formData.get("rating") ?? ""),
    comment: String(formData.get("comment") ?? ""),
  };
}

export async function createReviewAction(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const raw = readFormValues(formData);
  const parsed = parseForm(ReviewSchema, raw);
  if (!parsed.ok) return { errors: parsed.errors, values: raw };

  const { membership, supabase } = await getActionContext();
  const { data: review, error } = await supabase.from("reviews").insert({
    organization_id: membership.organization_id,
    booking_id: parsed.data.booking_id ?? null,
    client_id: parsed.data.client_id,
    employee_id: parsed.data.employee_id ?? null,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? null,
  }).select("id").single();

  if (error) return { errors: { _form: error.message }, values: raw };

  // Look up names for the notification (fire-and-forget)
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", parsed.data.client_id)
    .maybeSingle();
  let employeeName: string | null = null;
  if (parsed.data.employee_id) {
    const { data: emp } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", parsed.data.employee_id)
      .maybeSingle();
    employeeName = emp?.full_name ?? null;
  }

  notifyReviewSubmitted(membership.organization_id, {
    rating: parsed.data.rating,
    clientName: client?.name ?? "A client",
    employeeName,
    reviewId: review.id,
    reviewText: parsed.data.comment ?? null,
  });

  revalidatePath("/app/reviews");
  revalidatePath("/app");
  redirect("/app/reviews");
}

export async function deleteReviewAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  const { error } = await supabase.from("reviews").delete().eq("id", id).eq("organization_id", membership.organization_id);
  if (error) throw error;
  revalidatePath("/app/reviews");
}

/**
 * Owner-side review edit — primarily for typo fixes or adding context the
 * client wrote awkwardly. Admin-only; does NOT refire the review-submitted
 * automation (the review's already landed; we don't want to re-email on
 * every edit).
 */
export async function updateReviewAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing review id." };

  const ratingRaw = String(formData.get("rating") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim();

  const rating = Number(ratingRaw);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Rating must be between 1 and 5." };
  }
  if (comment.length > 4000) {
    return { ok: false, error: "Keep the comment under 4,000 characters." };
  }

  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { ok: false, error: "Not authorized." };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ rating, comment: comment || null })
    .eq("id", id)
    .eq("organization_id", membership.organization_id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/reviews");
  return { ok: true };
}
