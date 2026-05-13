"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  CheckSquare,
  Square,
  Pencil,
  Trash2,
  RefreshCw,
  Bell,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  completeTaskAction,
  reopenTaskAction,
  deleteTaskAction,
  type TaskFormState,
} from "./actions";
import { format, isToday, isTomorrow, isPast } from "date-fns";

export type TaskRowData = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  remind_at: string | null;
  recurrence: string | null;
  completed_at: string | null;
  assigned_member: string | null; // display name
};

function formatDue(iso: string): { label: string; urgent: boolean } {
  const d = new Date(iso);
  if (isPast(d) && !isToday(d)) {
    return { label: `Overdue · ${format(d, "MMM d")}`, urgent: true };
  }
  if (isToday(d)) return { label: `Today · ${format(d, "h:mm a")}`, urgent: false };
  if (isTomorrow(d)) return { label: `Tomorrow · ${format(d, "h:mm a")}`, urgent: false };
  return { label: format(d, "MMM d, yyyy · h:mm a"), urgent: false };
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 wks",
  monthly: "Monthly",
  yearly: "Yearly",
};

const empty: TaskFormState = {};

function CompleteButton({ id, completed }: { id: string; completed: boolean }) {
  const action = completed
    ? reopenTaskAction.bind(null, id)
    : completeTaskAction.bind(null, id);
  const [, formAction, pending] = useActionState(action, empty);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        title={completed ? "Reopen task" : "Mark complete"}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          completed
            ? "border-emerald-500 bg-emerald-500 text-white hover:border-emerald-400 hover:bg-emerald-400"
            : "border-muted-foreground/40 text-transparent hover:border-primary hover:text-primary",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        aria-label={completed ? "Reopen" : "Complete"}
      >
        {completed ? (
          <CheckSquare className="h-3 w-3" />
        ) : (
          <Square className="h-3 w-3" />
        )}
      </button>
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [, formAction, pending] = useActionState(
    deleteTaskAction.bind(null, id),
    empty,
  );

  function handleSubmit(e: React.FormEvent) {
    if (!confirm("Delete this task? This cannot be undone.")) {
      e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
      <button
        type="submit"
        disabled={pending}
        title="Delete task"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

export function TaskRow({
  task,
  canManage,
}: {
  task: TaskRowData;
  canManage: boolean;
}) {
  const done = !!task.completed_at;
  const due = task.due_at ? formatDue(task.due_at) : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted/40",
        done && "opacity-60",
      )}
    >
      {/* Checkbox */}
      <div className="mt-0.5">
        <CompleteButton id={task.id} completed={done} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium text-foreground",
            done && "line-through text-muted-foreground",
          )}
        >
          {task.title}
        </p>

        {task.notes && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {task.notes}
          </p>
        )}

        {/* Meta row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                due.urgent
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground",
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {due.label}
            </span>
          )}

          {task.remind_at && !done && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Bell className="h-3 w-3" />
              {format(new Date(task.remind_at), "MMM d, h:mm a")}
            </span>
          )}

          {task.recurrence && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              {RECURRENCE_LABELS[task.recurrence] ?? task.recurrence}
            </span>
          )}

          {task.assigned_member && (
            <span className="text-xs text-muted-foreground">
              → {task.assigned_member}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {canManage && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Link
            href={`/app/tasks/${task.id}/edit`}
            title="Edit task"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <DeleteButton id={task.id} />
        </div>
      )}
    </div>
  );
}
