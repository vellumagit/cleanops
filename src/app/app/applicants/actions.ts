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

export type HireFormState = {
  errors?: Partial<
    Record<"name" | "email" | "role" | "pay_rate" | "_form", string>
  >;
  /** Set once the invite exists and the applicant is stamped hired. */
  hired?: {
    email: string;
    token: string;
    emailSent: boolean;
    emailError: string | null;
  };
};

/**
 * The hire moment, without retyping: the applicant's name/email prefill the
 * invite, the wage and engagement are chosen here, and accepting the invite
 * creates the membership with both applied — plus any assign_on_join
 * training modules. Reuses sendInvitationAction verbatim so every
 * battle-tested check (duplicate member, pending invite, email delivery
 * with copy-link fallback) rides along.
 */
export async function hireApplicantAction(
  applicantId: string,
  _prev: HireFormState,
  formData: FormData,
): Promise<HireFormState> {
  const { membership } = await getActionContext();
  if (!["owner", "admin"].includes(membership.role)) {
    return { errors: { _form: "Only owners and admins can hire." } };
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data: applicant } = (await admin
    .from("job_applicants" as never)
    .select("id, status")
    .eq("id" as never, applicantId as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: { id: string; status: string } | null;
  };
  if (!applicant) return { errors: { _form: "Applicant not found." } };
  if (applicant.status === "hired") {
    return {
      errors: {
        _form:
          "They're already marked hired — the invite was sent. Manage it from the Employees page.",
      },
    };
  }

  const { sendInvitationAction } = await import("../employees/actions");
  const invite = await sendInvitationAction({}, formData);
  if (invite.errors) return { errors: invite.errors };

  const token = invite.values?._token ?? "";
  if (!token) {
    return { errors: { _form: "The invite could not be created — try again." } };
  }

  await admin
    .from("job_applicants" as never)
    .update({
      status: "hired",
      reviewed_by: membership.id,
      reviewed_at: new Date().toISOString(),
    } as never)
    .eq("id" as never, applicantId as never)
    .eq("organization_id" as never, membership.organization_id as never);

  revalidatePath(`/app/applicants/${applicantId}`);
  revalidatePath("/app/applicants");
  return {
    hired: {
      email: String(formData.get("email") ?? ""),
      token,
      emailSent: invite.values?._emailSent === "1",
      emailError: invite.values?._emailError || null,
    },
  };
}

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
