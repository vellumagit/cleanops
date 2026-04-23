"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { setTrainingCompletionAction } from "../actions";

export type AssignmentRow = {
  employee_id: string;
  employee_name: string;
  role: string;
  assignment_id: string | null;
  completed_at: string | null;
  assigned_at: string | null;
  progress_steps: number;
};

/**
 * List of every active employee with a per-row toggle to mark training
 * complete / incomplete for this module. Handles three states:
 *   - No assignment yet: toggle creates one marked complete.
 *   - Assigned but not complete: shows step progress + mark-complete button.
 *   - Complete: shows completion date + undo.
 */
export function TrainingAssignmentsPanel({
  moduleId,
  rows,
}: {
  moduleId: string;
  rows: AssignmentRow[];
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <AssignmentRowItem key={row.employee_id} moduleId={moduleId} row={row} />
      ))}
    </ul>
  );
}

function AssignmentRowItem({
  moduleId,
  row,
}: {
  moduleId: string;
  row: AssignmentRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isComplete = !!row.completed_at;

  function toggle(completed: boolean) {
    const fd = new FormData();
    fd.set("module_id", moduleId);
    fd.set("employee_id", row.employee_id);
    fd.set("completed", completed ? "1" : "0");
    startTransition(async () => {
      const res = await setTrainingCompletionAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(completed ? "Marked complete" : "Marked incomplete");
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{row.employee_name}</span>
          {row.role && row.role !== "employee" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {row.role}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isComplete
            ? `Completed ${formatDate(row.completed_at!)}`
            : row.assignment_id
              ? `In progress · ${row.progress_steps} step${
                  row.progress_steps === 1 ? "" : "s"
                } done`
              : "Not assigned yet"}
        </p>
      </div>
      {isComplete ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => toggle(false)}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Undo"
          )}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => toggle(true)}
          disabled={pending}
          className={cn("gap-1.5")}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Mark trained
        </Button>
      )}
    </li>
  );
}
