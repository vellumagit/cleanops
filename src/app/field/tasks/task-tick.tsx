"use client";

import { useActionState, useEffect } from "react";
import { CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import {
  completeTaskAction,
  reopenTaskAction,
  type TaskFormState,
} from "@/app/app/tasks/actions";

const empty: TaskFormState = {};

/** The tick box on a cleaner's task: a thumb-sized target, done or undone. */
export function TaskTick({ id, done, title }: { id: string; done: boolean; title: string }) {
  const action = done ? reopenTaskAction.bind(null, id) : completeTaskAction.bind(null, id);
  const [state, formAction, pending] = useActionState(action, empty);

  useEffect(() => {
    const message = state.errors?._form;
    if (message) toast.error(message);
  }, [state]);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        aria-label={done ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
        className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted disabled:opacity-50"
      >
        {done ? <CheckSquare className="h-6 w-6 text-emerald-600" /> : <Square className="h-6 w-6" />}
      </button>
    </form>
  );
}
