"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteEmployeeAction,
  type DeleteEmployeeState,
} from "../../actions";

/**
 * Form that calls the action directly via useActionState. The action
 * returns state for business-logic errors (wrong role, missing FK,
 * payroll-protection) and only throws on redirect() success. That
 * way Next's framework handles the redirect natively without our
 * wrapper having to detect-and-re-throw the NEXT_REDIRECT digest —
 * the dance that caused the "Server Components render" error we hit
 * 2026-06-01.
 */
export function DeleteEmployeeForm({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteEmployeeState,
    FormData
  >(deleteEmployeeAction, undefined);

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
