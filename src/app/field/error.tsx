"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Error boundary for the /field/* employee app.
 * Mobile-friendly: large tap target, clear language.
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
    <div className="flex min-h-[60dvh] items-center justify-center px-6">
      <div className="mx-auto max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
          <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">
            Try again — if this keeps happening, let your manager know.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-3 text-base font-medium text-background transition-opacity hover:opacity-90 active:opacity-80"
        >
          <RotateCcw className="h-5 w-5" />
          Try again
        </button>
      </div>
    </div>
  );
}
