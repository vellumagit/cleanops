"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteEmployeeAction } from "../../actions";

type State = { error?: string } | undefined;

function deleteAction(_prev: State, formData: FormData): Promise<State> {
  return deleteEmployeeAction(formData)
    .then(() => undefined)
    .catch((err: unknown) => ({
      error: err instanceof Error ? err.message : "Could not delete employee.",
    }));
}

export function DeleteEmployeeForm({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(deleteAction, undefined);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={memberId} />

      {state?.error && (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (
            !confirm(
              `Permanently delete ${name}? This cannot be undone.\n\nBookings and timesheets they appear in will be preserved; their name will show as "Unknown".`,
            )
          ) {
            e.preventDefault();
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {pending ? "Deleting…" : "Delete employee"}
      </button>
    </form>
  );
}
