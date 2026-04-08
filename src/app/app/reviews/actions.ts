"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { ReviewSchema } from "@/lib/validators/reviews";

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
  const { error } = await supabase.from("reviews").insert({
    organization_id: membership.organization_id,
    booking_id: parsed.data.booking_id ?? null,
    client_id: parsed.data.client_id,
    employee_id: parsed.data.employee_id ?? null,
    rating: parsed.data.rating,
    comment: parsed.data.comment ?? null,
  });

  if (error) return { errors: { _form: error.message }, values: raw };
  revalidatePath("/app/reviews");
  revalidatePath("/app");
  redirect("/app/reviews");
}

export async function deleteReviewAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { supabase } = await getActionContext();
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/app/reviews");
}
