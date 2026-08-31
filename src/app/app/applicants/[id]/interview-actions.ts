"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/audit";

type Result = { ok: true } | { ok: false; error: string };

const MAX_ANSWER_LEN = 5000;
const MAX_NOTES_LEN = 10000;

function isAdmin(role: string): boolean {
  return ["owner", "admin"].includes(role);
}

/**
 * Start an interview: snapshot the questionnaire's questions onto the
 * applicant so later edits to the library never touch this record.
 */
export async function startInterviewAction(
  applicantId: string,
  hiringDocId: string,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "You don't have permission to run interviews." };
  }

  const admin = createSupabaseAdminClient();

  const [{ data: applicant }, { data: doc }] = await Promise.all([
    admin
      .from("job_applicants" as never)
      .select("id")
      .eq("id" as never, applicantId as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )
      .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>,
    admin
      .from("hiring_docs" as never)
      .select("id, title, items, kind")
      .eq("id" as never, hiringDocId as never)
      .eq(
        "organization_id" as never,
        membership.organization_id as never,
      )
      .maybeSingle() as unknown as Promise<{
      data: {
        id: string;
        title: string;
        items: unknown;
        kind: string;
      } | null;
    }>,
  ]);
  if (!applicant) return { ok: false, error: "Applicant not found." };
  if (!doc || doc.kind !== "questionnaire") {
    return { ok: false, error: "Questionnaire not found." };
  }

  const questions = Array.isArray(doc.items)
    ? (doc.items as unknown[]).map((q) => String(q)).slice(0, 100)
    : [];
  if (questions.length === 0) {
    return { ok: false, error: "That questionnaire has no questions yet." };
  }

  const { error } = (await (admin
    .from("applicant_interviews" as never)
    .insert({
      organization_id: membership.organization_id,
      applicant_id: applicantId,
      hiring_doc_id: hiringDocId,
      title: doc.title,
      questions,
      answers: questions.map(() => ""),
      conducted_by: membership.id,
    } as never) as unknown as Promise<{ error: { message: string } | null }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "create",
    entity: "applicant",
    entity_id: applicantId,
    after: { interview: doc.title, questions: questions.length },
  });

  revalidatePath(`/app/applicants/${applicantId}`);
  return { ok: true };
}

/** Save the answers (and optional notes) of one interview. */
export async function saveInterviewAction(
  interviewId: string,
  formData: FormData,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "You don't have permission to run interviews." };
  }

  const admin = createSupabaseAdminClient();
  const { data: interview } = (await admin
    .from("applicant_interviews" as never)
    .select("id, organization_id, applicant_id, questions")
    .eq("id" as never, interviewId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      applicant_id: string;
      questions: unknown;
    } | null;
  };
  if (!interview || interview.organization_id !== membership.organization_id) {
    return { ok: false, error: "Interview not found." };
  }

  // Answers arrive as answer_0 … answer_N, one per snapshot question.
  // The snapshot is the authority on how many there are.
  const count = Array.isArray(interview.questions)
    ? interview.questions.length
    : 0;
  const answers = Array.from({ length: count }, (_, i) =>
    String(formData.get(`answer_${i}`) ?? "").slice(0, MAX_ANSWER_LEN),
  );
  const notes =
    String(formData.get("notes") ?? "")
      .trim()
      .slice(0, MAX_NOTES_LEN) || null;

  const { error } = (await (admin
    .from("applicant_interviews" as never)
    .update({ answers, notes } as never)
    .eq("id" as never, interviewId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "update",
    entity: "applicant",
    entity_id: interview.applicant_id,
    after: {
      interview_id: interviewId,
      answered: answers.filter((a) => a.trim().length > 0).length,
      of: count,
    },
  });

  revalidatePath(`/app/applicants/${interview.applicant_id}`);
  return { ok: true };
}

/** Delete one recorded interview. */
export async function deleteInterviewAction(
  interviewId: string,
): Promise<Result> {
  const { membership } = await getActionContext();
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "You don't have permission to run interviews." };
  }

  const admin = createSupabaseAdminClient();
  const { data: interview } = (await admin
    .from("applicant_interviews" as never)
    .select("id, organization_id, applicant_id, title")
    .eq("id" as never, interviewId as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      applicant_id: string;
      title: string;
    } | null;
  };
  if (!interview || interview.organization_id !== membership.organization_id) {
    return { ok: false, error: "Interview not found." };
  }

  const { error } = (await (admin
    .from("applicant_interviews" as never)
    .delete()
    .eq("id" as never, interviewId as never) as unknown as Promise<{
    error: { message: string } | null;
  }>));
  if (error) return { ok: false, error: error.message };

  await logAuditEvent({
    membership,
    action: "delete",
    entity: "applicant",
    entity_id: interview.applicant_id,
    before: { interview: interview.title },
  });

  revalidatePath(`/app/applicants/${interview.applicant_id}`);
  return { ok: true };
}
