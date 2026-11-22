"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/submit-button";
import { updateThresholdAction, type ThresholdsState } from "./actions";
import type { ThresholdSpec } from "./threshold-fields";

/**
 * One timing setting, saved on its own, shown under the automation it times
 * ("Auto-void long-overdue invoices" → "Void when [365] days past due").
 */
export function ThresholdInline({
  spec,
  value,
}: {
  spec: ThresholdSpec;
  value: number | null;
}) {
  const [state, formAction] = useActionState<ThresholdsState, FormData>(
    updateThresholdAction,
    {},
  );
  const initial = value == null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const dirty = draft !== initial;

  return (
    <form
      action={formAction}
      className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2"
    >
      <input type="hidden" name="field" value={spec.field} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor={`t-${spec.field}`} className="font-medium">
          {spec.label}
        </label>
        <Input
          id={`t-${spec.field}`}
          name="value"
          type="number"
          inputMode="numeric"
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="never"
          className="h-8 w-24"
        />
        <span className="text-muted-foreground">{spec.suffix}</span>
        {dirty && (
          <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
            Save
          </SubmitButton>
        )}
        {!dirty && state.ok && (
          <span className="text-emerald-700 dark:text-emerald-400">Saved</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{spec.hint}</p>
      {state.error && (
        <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
