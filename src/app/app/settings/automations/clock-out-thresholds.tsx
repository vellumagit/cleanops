"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  MIN_GRACE_MINUTES,
  MAX_GRACE_MINUTES,
  MIN_REMINDER_INTERVAL_MINUTES,
  MAX_REMINDER_INTERVAL_MINUTES,
  THRESHOLD_STEP_MINUTES,
} from "@/lib/shift-overrun";
import { updateClockOutThresholdsAction } from "./actions";

/** "2h", "45m", "2h 30m" — how the chosen interval reads back to a human. */
function describe(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function options(min: number, max: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max; v += THRESHOLD_STEP_MINUTES) out.push(v);
  return out;
}

/**
 * Thresholds for the forgotten-clock-out guard.
 *
 * Both were hardcoded (120 / 30). A 6-hour deep clean and a 45-minute office
 * tidy don't warrant the same grace period, so they're per-org now. Presented
 * as 5-minute steps because that's the granularity anyone actually reasons in
 * — and because a free-text minutes box invites the typo (30 days of grace)
 * that would quietly disable the guard entirely.
 */
export function ClockOutThresholds({
  graceMinutes,
  reminderIntervalMinutes,
}: {
  graceMinutes: number;
  reminderIntervalMinutes: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [grace, setGrace] = useState(graceMinutes);
  const [interval, setIntervalMin] = useState(reminderIntervalMinutes);

  const dirty =
    grace !== graceMinutes || interval !== reminderIntervalMinutes;

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("grace_minutes", String(grace));
      fd.set("reminder_interval_minutes", String(interval));
      const result = await updateClockOutThresholdsAction(fd);
      if (result.ok) {
        toast.success("Clock-out thresholds saved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Remind every
          </span>
          <select
            value={interval}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {options(
              MIN_REMINDER_INTERVAL_MINUTES,
              MAX_REMINDER_INTERVAL_MINUTES,
            ).map((v) => (
              <option key={v} value={v}>
                {describe(v)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Cap the shift &amp; alert after
          </span>
          <select
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {options(MIN_GRACE_MINUTES, MAX_GRACE_MINUTES).map((v) => (
              <option key={v} value={v}>
                {describe(v)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Both are measured from the job&rsquo;s expected end — its scheduled
        length, divided across the crew when you divide team hours. A cleaner
        still clocked in gets nudged every{" "}
        <span className="font-medium">{describe(interval)}</span>, and{" "}
        <span className="font-medium">{describe(grace)}</span> past the end the
        shift is capped, flagged for review, and management is notified. Hours
        are never silently reduced.
      </p>

      {dirty && (
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : "Save thresholds"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setGrace(graceMinutes);
              setIntervalMin(reminderIntervalMinutes);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
