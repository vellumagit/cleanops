"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteEmployeeAction } from "../../actions";

type State = { error?: string } | undefined;

/**
 * next/navigation's redirect() and notFound() signal navigation by
 * throwing errors with a `digest` property. They MUST propagate up to
 * Next.js's handler — catching them as if they were real errors
 * strands the user on a now-deleted page that then fails to re-render
 * (the "Server Components render" error we hit 2026-06-01).
 */
function isNextNavigationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

function deleteAction(_prev: State, formData: FormData): Promise<State> {
  return deleteEmployeeAction(formData)
    .then(() => undefined)
    .catch((err: unknown) => {
      if (isNextNavigationError(err)) throw err;
      return {
        error: err instanceof Error ? err.message : "Could not delete employee.",
      };
    });
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
