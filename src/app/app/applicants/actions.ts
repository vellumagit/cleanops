"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext } from "@/lib/actions";

export type ApplicantStatus =
  | "new"
  | "reviewing"
  | "interview"
  | "hired"
  | "rejected";

const STATUSES: ApplicantStatus[] = [
  "new",
  "reviewing",
  "interview",
  "hired",
  "rejected",
];

type Result = { ok: true } | { ok: false; error: string };

/** Move an applicant along the hiring pipeline. Owner/admin only (RLS). */
export async function setApplicantStatusAction(
  id: string,
  status: string,
): Promise<Result> {
  if (!id) return { ok: false, error: "Missing id" };
  if (!STATUSES.includes(status as ApplicantStatus)) {
    return { ok: false, error: "Invalid status" };
  }
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Not allowed" };
  }
  const { error } = (await supabase
    .from("job_applicants" as never)
    .update({
      status,
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };
  revalidatePath("/app/applicants", "page");
  revalidatePath(`/app/applicants/${id}`, "page");
  return { ok: true };
}

/** Save internal notes on an applicant. */
export async function saveApplicantNotesAction(
  id: string,
  notes: string,
): Promise<Result> {
  if (!id) return { ok: false, error: "Missing id" };
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { ok: false, error: "Not allowed" };
  }
  const { error } = (await supabase
    .from("job_applicants" as never)
    .update({ notes: notes.trim() || null } as never)
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)) as unknown as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/app/applicants/${id}`, "page");
  return { ok: true };
}

/** Permanently delete an applicant. */
export async function deleteApplicantAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { membership, supabase } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) return;
  await (supabase
    .from("job_applicants" as never)
    .delete()
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never) as unknown as Promise<unknown>);
  revalidatePath("/app/applicants", "page");
  redirect("/app/applicants");
}
