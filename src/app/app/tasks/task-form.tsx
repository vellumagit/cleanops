"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buttonVariants } from "@/components/ui/button";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  createTaskAction,
  updateTaskAction,
  type TaskFormState,
} from "./actions";

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
 * Convert a UTC ISO string to a datetime-local value (YYYY-MM-DDTHH:mm)
 * in local browser time — used to pre-fill date/time inputs.
 */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

export function TaskForm({
  mode,
  id,
  defaults,
  members = [],
}: {
  mode: "create" | "edit";
  id?: string;
  defaults?: Defaults;
  members?: MemberOption[];
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
          <Input
            id="due_at"
            name="due_at"
            type="datetime-local"
            defaultValue={isoToLocalInput(v.due_at)}
          />
        </FormField>

        <FormField
          label="Remind me at"
          htmlFor="remind_at"
          hint="You'll get a push notification at this time."
          error={state.errors?.remind_at}
        >
          <Input
            id="remind_at"
            name="remind_at"
            type="datetime-local"
            defaultValue={isoToLocalInput(v.remind_at)}
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
