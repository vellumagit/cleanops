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

  await supabase.from("tasks" as never).insert({
    organization_id: task.organization_id,
    created_by: task.created_by,
    assigned_to: task.assigned_to,
    title: task.title,
    notes: task.notes,
    due_at: nextDue.toISOString(),
    remind_at: nextRemind ? nextRemind.toISOString() : null,
    recurrence: task.recurrence,
  } as never);
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

  const { data, error } = await supabase.from("tasks" as never).insert({
    organization_id: membership.organization_id,
    created_by: membership.id,
    title: parsed.data.title,
    notes: parsed.data.notes ?? null,
    assigned_to: parsed.data.assigned_to ?? null,
    due_at: parsed.data.due_at ?? null,
    remind_at: parsed.data.remind_at ?? null,
    recurrence: parsed.data.recurrence ?? null,
  } as never).select("id").single() as unknown as { data: { id: string } | null; error: Error | null };

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
  const { supabase } = await getActionContext();
  const raw = readFormValues(formData);
  const parsed = parseForm(TaskSchema, raw);

  if (!parsed.ok) return { errors: parsed.errors, values: raw as never };

  const { error } = await supabase
    .from("tasks" as never)
    .update({
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      due_at: parsed.data.due_at ?? null,
      remind_at: parsed.data.remind_at ?? null,
      recurrence: parsed.data.recurrence ?? null,
      // Reset reminded_at whenever remind_at changes so the reminder fires again.
      reminded_at: null,
    } as never)
    .eq("id" as never, id);

  if (error) {
    return { errors: { _form: "Failed to save task. Please try again." } };
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
    .from("tasks" as never)
    .select("id, organization_id, created_by, assigned_to, title, notes, due_at, remind_at, recurrence")
    .eq("id" as never, id)
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
    .from("tasks" as never)
    .update({ completed_at: new Date().toISOString() } as never)
    .eq("id" as never, id);

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
    .from("tasks" as never)
    .update({ completed_at: null } as never)
    .eq("id" as never, id);

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
    .from("tasks" as never)
    .delete()
    .eq("id" as never, id);

  if (error) {
    return { errors: { _form: "Failed to delete task." } };
  }

  revalidatePath("/app/tasks");
  redirect("/app/tasks");
}
