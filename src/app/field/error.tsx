"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Error boundary for the /field/* employee app.
 *
 * TEMP DIAGNOSTIC MODE: while we're root-causing a regression that
 * crashes /field/jobs without surfacing the cause, this boundary
 * shows the actual error message + digest on screen so the field
 * user can paste it back. Revert to the friendly UI once fixed.
 */
export default function FieldError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[FieldError]", error);
  }, [error]);

  return (
    <div className="px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Something went wrong</h2>
            <p className="text-xs text-muted-foreground">
              Try again — if this keeps happening, let your manager know.
            </p>
          </div>
        </div>

        {/* DIAG: actual error details so we can root-cause the
            /field/jobs regression. Remove once fixed. */}
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/40 dark:bg-red-950/30">
          <p className="font-semibold text-red-900 dark:text-red-200">
            Diagnostic
          </p>
          <p className="mt-1 break-words text-red-800 dark:text-red-300">
            <strong>Message:</strong> {error.message || "(no message)"}
          </p>
          {error.digest && (
            <p className="mt-1 break-words text-red-800 dark:text-red-300">
              <strong>Digest:</strong> {error.digest}
            </p>
          )}
          {error.stack && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-red-100 p-2 text-[11px] text-red-900 dark:bg-red-950/50 dark:text-red-200">
              {error.stack}
            </pre>
          )}
        </div>

        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80"
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
