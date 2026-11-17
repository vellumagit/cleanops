"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { TaskSchema } from "@/lib/validators/tasks";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";

type Field = keyof typeof TaskSchema.shape;
export type TaskFormState = ActionState<Field & string>;

function readFormValues(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    notes: String(formData.get("notes") ?? "") || null,
    assigned_to: String(formData.get("assigned_to") ?? "") || null,
    due_at: String(formData.get("due_at") ?? "") || null,
    remind_at: String(formData.get("remind_at") ?? "") || null,
    recurrence: String(formData.get("recurrence") ?? "") || null,
  };
}

/**
 * When a recurring task is completed, generate the next occurrence.
 * Returns the new task id or null if non-recurring.
 */
async function spawnNextOccurrence(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  task: {
    id: string;
    organization_id: string;
    created_by: string | null;
    assigned_to: string | null;
    title: string;
    notes: string | null;
    due_at: string | null;
    remind_at: string | null;
    recurrence: string | null;
  },
): Promise<void> {
  if (!task.recurrence || !task.due_at) return;

  const due = new Date(task.due_at);
  let nextDue: Date;
  let nextRemind: Date | null = null;

  switch (task.recurrence) {
    case "daily":
      nextDue = addDays(due, 1);
      break;
    case "weekly":
      nextDue = addWeeks(due, 1);
      break;
    case "biweekly":
      nextDue = addWeeks(due, 2);
      break;
    case "monthly":
      nextDue = addMonths(due, 1);
      break;
    case "yearly":
      nextDue = addYears(due, 1);
      break;
    default:
      return;
  }

  if (task.remind_at) {
    const remind = new Date(task.remind_at);
    const offsetMs = due.getTime() - remind.getTime();
    nextRemind = new Date(nextDue.getTime() - offsetMs);
  }

  await supabase.from("tasks").insert({
    organization_id: task.organization_id,
    created_by: task.created_by,
    assigned_to: task.assigned_to,
    title: task.title,
    notes: task.notes,
    due_at: nextDue.toISOString(),
    remind_at: nextRemind ? nextRemind.toISOString() : null,
    recurrence: task.recurrence,
  });
}

/**
 * The form's "2026-12-01T09:00" is a wall-clock time in the COMPANY's
 * timezone. Stored as typed, Postgres read it as UTC: 9:00 AM became 3:00 AM
 * in Alberta, and because the edit page showed that back as local time, every
 * save moved a task another six hours earlier. A value that already carries
 * its own offset (an exact instant) is kept as it is.
 */
async function toInstant(value: string | null | undefined, organizationId: string): Promise<string | null> {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const { getOrgTimezone } = await import("@/lib/org-timezone");
  const { localInputToUtcIso } = await import("@/lib/validators/common");
  const iso = localInputToUtcIso(v, await getOrgTimezone(organizationId));
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { membership, supabase } = await getActionContext();
  const raw = readFormValues(formData);
  const parsed = parseForm(TaskSchema, raw);

  if (!parsed.ok) return { errors: parsed.errors, values: raw as never };

  const { error } = await supabase.from("tasks").insert({
    organization_id: membership.organization_id,
    created_by: membership.id,
    title: parsed.data.title,
    notes: parsed.data.notes ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    due_at: await toInstant(parsed.data.due_at, membership.organization_id),
    remind_at: await toInstant(parsed.data.remind_at, membership.organization_id),
    recurrence: parsed.data.recurrence ?? null,
  });

  if (error) {
    return { errors: { _form: "Failed to create task. Please try again." } };
  }

  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateTaskAction(
  id: string,
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const { membership, supabase } = await getActionContext();
  // Editing a task is the office's (the edit page only admits them). A
  // cleaner ticks their own task off with completeTaskAction; through this
  // action one could take over anyone's task by assigning it to themselves.
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    return { errors: { _form: "Only the office can edit a task." } };
  }
  const raw = readFormValues(formData);
  const parsed = parseForm(TaskSchema, raw);

  if (!parsed.ok) return { errors: parsed.errors, values: raw as never };

  const dueAt = await toInstant(parsed.data.due_at, membership.organization_id);
  const remindAt = await toInstant(parsed.data.remind_at, membership.organization_id);

  // Re-arm the reminder only when its time actually changed. Clearing
  // reminded_at on every save sent an old reminder again after any edit.
  const { data: before } = (await supabase
    .from("tasks")
    .select("remind_at")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: { remind_at: string | null } | null };
  const sameReminder =
    (before?.remind_at ? new Date(before.remind_at).getTime() : null) ===
    (remindAt ? new Date(remindAt).getTime() : null);

  // .select() so a save that matched no task says so instead of returning
  // to the list as if it had saved.
  const { data: saved, error } = (await supabase
    .from("tasks")
    .update({
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      due_at: dueAt,
      remind_at: remindAt,
      recurrence: parsed.data.recurrence ?? null,
      ...(sameReminder ? {} : { reminded_at: null }),
    })
    .eq("id", id)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { errors: { _form: "Failed to save task. Please try again." } };
  }
  if (!saved?.length) {
    return { errors: { _form: "This task wasn't saved. It may have been deleted, or it isn't yours to change." } };
  }

  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export async function completeTaskAction(
  id: string,
  _prev: TaskFormState,
  _formData: FormData,
): Promise<TaskFormState> {
  const { supabase } = await getActionContext();

  const { data: task, error: fetchErr } = await supabase
    .from("tasks")
    .select("id, organization_id, created_by, assigned_to, title, notes, due_at, remind_at, recurrence")
    .eq("id", id)
    .maybeSingle() as unknown as { data: {
      id: string;
      organization_id: string;
      created_by: string | null;
      assigned_to: string | null;
      title: string;
      notes: string | null;
      due_at: string | null;
      remind_at: string | null;
      recurrence: string | null;
    } | null; error: Error | null };

  if (fetchErr || !task) {
    return { errors: { _form: "Task not found." } };
  }

  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return { errors: { _form: "Failed to complete task." } };
  }

  // Spawn next occurrence for recurring tasks.
  await spawnNextOccurrence(supabase, task).catch(() => {});

  revalidatePath("/app/tasks");
  return {};
}

// ---------------------------------------------------------------------------
// Reopen (un-complete)
// ---------------------------------------------------------------------------

export async function reopenTaskAction(
  id: string,
  _prev: TaskFormState,
  _formData: FormData,
): Promise<TaskFormState> {
  const { supabase } = await getActionContext();

  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: null })
    .eq("id", id);

  if (error) {
    return { errors: { _form: "Failed to reopen task." } };
  }

  revalidatePath("/app/tasks");
  return {};
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteTaskAction(
  id: string,
  _prev: TaskFormState,
  _formData: FormData,
): Promise<TaskFormState> {
  const { supabase } = await getActionContext();

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", id);

  if (error) {
    return { errors: { _form: "Failed to delete task." } };
  }

  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}
