"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionContext, parseForm, type ActionState } from "@/lib/actions";
import { TaskSchema } from "@/lib/validators/tasks";
import { addDays, addWeeks, addMonths, addYears } from "date-fns";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";

/**
 * Tell someone a task is now theirs. Nothing did: a task assigned to a
 * cleaner sat on the office's list and the cleaner never heard of it. Not
 * sent when someone assigns a task to themselves. Best-effort.
 */
async function tellAssignee(input: {
  organizationId: string;
  assigneeId: string | null | undefined;
  actorId: string;
  title: string;
}): Promise<void> {
  if (!input.assigneeId || input.assigneeId === input.actorId) return;
  try {
    const { data: who } = (await createSupabaseAdminClient()
      .from("memberships")
      .select("role")
      .eq("id", input.assigneeId)
      .eq("organization_id", input.organizationId)
      .maybeSingle()) as unknown as { data: { role: string } | null };
    if (!who) return;
    await notify({
      organizationId: input.organizationId,
      audience: "membership",
      membershipId: input.assigneeId,
      title: "New task for you",
      body: input.title,
      href: who.role === "employee" ? "/field/tasks" : "/app/tasks",
    });
  } catch (err) {
    console.error("[tasks] assignee notice failed:", err);
  }
}

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
  supabase: Pick<Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>, "from">,
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
  await tellAssignee({
    organizationId: membership.organization_id,
    assigneeId: parsed.data.assigned_to,
    actorId: membership.id,
    title: parsed.data.title,
  });

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
    .select("remind_at, assigned_to")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: { remind_at: string | null; assigned_to: string | null } | null };
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
  // Only when it changes hands: an edit to the title is not news.
  if ((parsed.data.assigned_to ?? null) !== (before?.assigned_to ?? null)) {
    await tellAssignee({
      organizationId: membership.organization_id,
      assigneeId: parsed.data.assigned_to,
      actorId: membership.id,
      title: parsed.data.title,
    });
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

  // .select() so a tick the database refused (someone else's task, for a
  // cleaner) says so. It used to come back as done with nothing changed.
  const { data: ticked, error } = (await supabase
    .from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id)
    .is("completed_at", null)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { errors: { _form: "Failed to complete task." } };
  }
  if (!ticked?.length) {
    return { errors: { _form: "That task isn't yours to tick off, or it was already done." } };
  }

  // Spawn next occurrence for recurring tasks. With the service client: the
  // person ticking has just been proved allowed to, and a cleaner's own
  // sign-in may not create tasks, so their repeating task never came back.
  await spawnNextOccurrence(createSupabaseAdminClient(), task).catch(() => {});

  revalidatePath("/app/tasks");
  revalidatePath("/field/tasks");
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

  const { data: reopened, error } = (await supabase
    .from("tasks")
    .update({ completed_at: null })
    .eq("id", id)
    .select("id")) as unknown as { data: Array<{ id: string }> | null; error: { message: string } | null };

  if (error) {
    return { errors: { _form: "Failed to reopen task." } };
  }
  if (!reopened?.length) {
    return { errors: { _form: "That task isn't yours to change." } };
  }

  revalidatePath("/app/tasks");
  revalidatePath("/field/tasks");
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
