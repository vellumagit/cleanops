"use server";

import { revalidatePath } from "next/cache";
import { getActionContext } from "@/lib/actions";

export type TrainingResult = { ok: true } | { ok: false; error: string };

/**
 * Toggle a training step's completion for the current employee. The
 * `completed_step_ids` column is a string[] on training_assignments. When the
 * full set of step ids is present we also stamp `completed_at`.
 */
export async function toggleStepAction(
  formData: FormData,
): Promise<TrainingResult> {
  const moduleId = String(formData.get("module_id") ?? "");
  const stepId = String(formData.get("step_id") ?? "");
  const desired = String(formData.get("desired") ?? "complete");
  if (!moduleId || !stepId) {
    return { ok: false, error: "Missing module or step id" };
  }

  const { membership, supabase } = await getActionContext();

  const [{ data: assignment, error: assignmentError }, { data: steps }] =
    await Promise.all([
      supabase
        .from("training_assignments")
        .select("id, completed_step_ids")
        .eq("module_id", moduleId)
        .eq("employee_id", membership.id)
        .maybeSingle(),
      supabase
        .from("training_steps")
        .select("id")
        .eq("module_id", moduleId),
    ]);

  if (assignmentError) return { ok: false, error: assignmentError.message };
  if (!assignment) {
    return { ok: false, error: "This module isn't assigned to you" };
  }

  const currentSet = new Set<string>(assignment.completed_step_ids ?? []);
  if (desired === "incomplete") {
    currentSet.delete(stepId);
  } else {
    currentSet.add(stepId);
  }

  const allStepIds = (steps ?? []).map((s) => s.id);
  const allDone =
    allStepIds.length > 0 && allStepIds.every((id) => currentSet.has(id));

  const { error: updateError } = await supabase
    .from("training_assignments")
    .update({
      completed_step_ids: Array.from(currentSet),
      completed_at: allDone ? new Date().toISOString() : null,
    })
    .eq("id", assignment.id);
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/field/training");
  revalidatePath(`/field/training/${moduleId}`);
  return { ok: true };
}
