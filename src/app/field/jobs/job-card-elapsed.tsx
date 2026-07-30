"use client";

import { cn } from "@/lib/utils";
import {
  useElapsed,
  formatElapsed,
  overrunMinutes,
  STALE_SHIFT_MS,
} from "../use-elapsed";

/**
 * "On the clock 3h 12m" — live on the jobs list, not just the Clock tab.
 *
 * The running total only existed on /field/clock, which is the one screen a
 * cleaner isn't looking at while they work. Putting it on the card is what
 * makes an overrun visible before the nightly cap has to guess at it.
 *
 * The overrun is anchored to the job's scheduled END, not to clock-in, and
 * mirrors sendShiftClockOutReminders exactly:
 *
 *     expectedEnd = max(scheduledStart, clockIn) + length
 *
 * Anchoring to clock-in instead looks equivalent but isn't: 42% of real time
 * entries start BEFORE their booking (travel, early arrival, median ~10min),
 * and those would show "over" while the card's own next line still says the
 * job runs another ten minutes. The max() is what lets a late start keep its
 * full window, and it's why this figure agrees to the second with the 30-min
 * nag and the 2-hour auto-close cap.
 */
export function JobCardElapsed({
  sinceIso,
  scheduledStartIso,
  scheduledMinutes,
  status,
}: {
  sinceIso: string;
  /** Segment-adjusted start — the same value the card prints below the pill. */
  scheduledStartIso: string;
  /** This member's own share of the job, already split/divided upstream. */
  scheduledMinutes: number;
  status: string;
}) {
  const elapsedMs = useElapsed(sinceIso);

  const startedMs = new Date(sinceIso).getTime();

  // Derive "now" from the ticking value so there's a single clock driving
  // the whole pill. Null until mount, which keeps hydration honest.
  const nowMs = elapsedMs == null ? null : startedMs + elapsedMs;

  const overMin =
    nowMs == null
      ? 0
      : overrunMinutes({
          clockInMs: startedMs,
          scheduledStartMs: new Date(scheduledStartIso).getTime(),
          scheduledMinutes,
          nowMs,
        });
  const isOver = overMin > 0;
  const isStale = elapsedMs != null && elapsedMs > STALE_SHIFT_MS;

  // The job is finished but this person's clock is still running — reachable
  // when a crewmate or the office closes the booking. "End job" is hidden in
  // exactly this state, so a cheerful green pulse would be a dead end; say
  // what's wrong and point at the one screen that can fix it.
  const orphaned = status === "completed";
  const warn = orphaned || isStale || isOver;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
        warn
          ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          warn ? "bg-amber-500" : "animate-pulse bg-emerald-500",
        )}
      />
      {orphaned ? "Still clocked in" : "On the clock"}
      {elapsedMs != null ? ` ${formatElapsed(elapsedMs)}` : ""}
      {isOver && !orphaned ? ` · ${formatElapsed(overMin * 60_000)} over` : ""}
    </span>
  );
}
