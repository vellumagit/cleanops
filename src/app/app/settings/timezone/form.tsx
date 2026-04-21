"use client";

import { useActionState } from "react";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { updateOrgTimezoneAction, type TimezoneState } from "./actions";

type Option = { value: string; label: string };

export function TimezoneForm({
  currentTz,
  options,
}: {
  currentTz: string;
  options: Option[];
}) {
  const [state, formAction] = useActionState<TimezoneState, FormData>(
    updateOrgTimezoneAction,
    {},
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <div>
        <Label htmlFor="timezone">Timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={currentTz}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {/* Include the current value even if it's not in COMMON_TIMEZONES
              (e.g. set manually via SQL). */}
          {!options.some((o) => o.value === currentTz) && (
            <option value={currentTz}>{currentTz}</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {state.error && (
        <p className="text-xs text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-xs text-emerald-700">Timezone updated.</p>
      )}

      <SubmitButton pendingLabel="Saving…">Save timezone</SubmitButton>
    </form>
  );
}
