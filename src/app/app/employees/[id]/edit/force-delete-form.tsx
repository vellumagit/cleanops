"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import {
  forceDeleteEmployeeAction,
  type DeleteEmployeeState,
} from "../../actions";

/**
 * Owner-only nuclear delete. Bypasses the "must be disabled first"
 * gate AND wipes the auth user. Use when the employee account is in
 * a broken state (auth wiped from dashboard out-of-band, never
 * accepted invite, MFA-stuck, etc) and you just need a clean slate.
 *
 * Passes the action directly to useActionState — the action returns
 * state for business-logic errors and only throws redirect() on
 * success, which Next handles natively. (See delete-employee-form
 * for the longer explanation of why this pattern matters.)
 */
export function ForceDeleteForm({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState<
    DeleteEmployeeState,
    FormData
  >(forceDeleteEmployeeAction, undefined);

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
