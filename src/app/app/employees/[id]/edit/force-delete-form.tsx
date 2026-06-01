"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { forceDeleteEmployeeAction } from "../../actions";

type State = { error?: string } | undefined;

/**
 * Re-throw the control-flow errors that next/navigation uses to signal
 * redirect() and notFound() so Next.js's framework handler can act on
 * them. Catching them as if they were real errors strands the user on
 * a now-deleted page that then fails to re-render — the exact
 * "Server Components render" error we saw 2026-06-01.
 */
function isNextNavigationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

function forceDeleteAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  return forceDeleteEmployeeAction(formData)
    .then(() => undefined)
    .catch((err: unknown) => {
      if (isNextNavigationError(err)) throw err;
      return {
        error: err instanceof Error ? err.message : "Could not remove employee.",
      };
    });
}

/**
 * Owner-only nuclear delete. Bypasses the "must be disabled first"
 * gate AND wipes the auth user. Use when the employee account is in
 * a broken state (auth wiped from dashboard out-of-band, never
 * accepted invite, MFA-stuck, etc) and you just need a clean slate.
 *
 * Shown alongside the normal delete in the danger zone — different
 * label and warning so it's obvious which one is the bigger hammer.
 */
export function ForceDeleteForm({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    forceDeleteAction,
    undefined,
  );

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
              `Force-remove ${name}?\n\n` +
                `This deletes their membership AND their login account. ` +
                `Use this when their account is broken/stuck and you want to ` +
                `re-invite them clean.\n\n` +
                `Bookings and timesheets they appear in are preserved; their ` +
                `name will show as "Unknown".\n\n` +
                `This cannot be undone.`,
            )
          ) {
            e.preventDefault();
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {pending ? "Removing…" : "Force-remove employee"}
      </button>
    </form>
  );
}
