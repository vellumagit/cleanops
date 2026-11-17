"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/when-preview";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createTaskAction,
  updateTaskAction,
  type TaskFormState,
} from "./actions";
import { toDatetimeLocal } from "@/lib/validators/common";

const empty: TaskFormState = {};

type MemberOption = { id: string; label: string };

type Defaults = {
  title?: string;
  notes?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  remind_at?: string | null;
  recurrence?: string | null;
};

/**
 * A stored instant as the datetime-local value (YYYY-MM-DDTHH:mm) for the
 * COMPANY's timezone: the same clock the save reads it back in. (It used to
 * be the browser's, or the server's while rendering, which is how a task
 * drifted six hours on every save.) A value that is already a form value,
 * handed back after a validation error, passes through.
 */
function isoToLocalInput(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) return iso;
  return toDatetimeLocal(iso, timezone);
}

export function TaskForm({
  mode,
  id,
  defaults,
  members = [],
  timezone,
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  members?: MemberOption[];
  /** The company's timezone: task times are shown and saved in it. */
  timezone: string;
}) {
  const action =
    mode === "create"
      ? createTaskAction
      : updateTaskAction.bind(null, id ?? "");

  const [state, formAction] = useActionState(action, empty);
  const v = { ...defaults, ...state.values } as Defaults;

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <FormField
        label="Title"
        htmlFor="title"
        required
        error={state.errors?.title}
      >
        <Input
          id="title"
          name="title"
          required
          defaultValue={v.title ?? ""}
          placeholder="e.g. Pick up cleaning supplies"
          autoComplete="off"
        />
      </FormField>

      <FormField label="Notes" htmlFor="notes" error={state.errors?.notes}>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={v.notes ?? ""}
          placeholder="Optional details or instructions…"
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Due date"
          htmlFor="due_at"
          error={state.errors?.due_at}
        >
          <DateTimeInput
            id="due_at"
            name="due_at"
            defaultValue={isoToLocalInput(v.due_at, timezone)}
          />
        </FormField>

        <FormField
          label="Remind me at"
          htmlFor="remind_at"
          hint="You'll get a push notification at this time."
          error={state.errors?.remind_at}
        >
          <DateTimeInput
            id="remind_at"
            name="remind_at"
            defaultValue={isoToLocalInput(v.remind_at, timezone)}
          />
        </FormField>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {members.length > 0 && (
          <FormField
            label="Assign to"
            htmlFor="assigned_to"
            error={state.errors?.assigned_to}
          >
            <FormSelect
              id="assigned_to"
              name="assigned_to"
              defaultValue={v.assigned_to ?? ""}
            >
              <option value="">— Unassigned —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
        )}

        <FormField
          label="Recurrence"
          htmlFor="recurrence"
          hint="Auto-creates the next task when this one is marked done."
          error={state.errors?.recurrence}
        >
          <FormSelect
            id="recurrence"
            name="recurrence"
            defaultValue={v.recurrence ?? ""}
          >
            <option value="">— No recurrence —</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </FormSelect>
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/app/tasks"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving…">
          {mode === "create" ? "Create task" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
