"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutomationFrequencyAction } from "./actions";

/**
 * A cadence knob beside the toggle it configures. Auto-saves on change —
 * a dropdown with a separate Save button is one click of ceremony more
 * than a cadence deserves. Generic: the review ask and the rebooking
 * nudge both use it with their own option sets.
 */
export function AutomationFrequencySelect({
  automationKey,
  current,
  options,
}: {
  automationKey: string;
  current: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="mr-2 flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      At most
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const fd = new FormData();
          fd.set("key", automationKey);
          fd.set("frequency", e.target.value);
          startTransition(async () => {
            await setAutomationFrequencyAction(fd);
            router.refresh();
          });
        }}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
