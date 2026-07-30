"use client";

import { useEffect, useState } from "react";

/** "3h 12m" / "47m" — the number a person needs to notice something is wrong. */
export function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Live elapsed time since clock-in, ticking every 30s.
 *
 * The clock card used to read "Since 8:04 AM" — no date, no duration. Someone
 * opening the app on Thursday saw what looked like this morning and tapped
 * Clock out, which is exactly how a 68-hour shift gets recorded. A running
 * total makes a stale shift impossible to misread.
 *
 * Starts null and fills in on mount: computing a duration during render is
 * both impure and a hydration mismatch waiting to happen. Callers should keep
 * their layout stable across that null → number transition.
 */
export function useElapsed(sinceIso: string | null): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (!sinceIso) return;
    const started = new Date(sinceIso).getTime();
    const tick = () => setElapsedMs(Date.now() - started);
    // First tick on a timeout rather than inline: setting state synchronously
    // inside an effect forces a second render pass before paint, which is
    // what react-hooks/set-state-in-effect exists to prevent. A 0ms defer
    // lands in the same frame visually.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [sinceIso]);
  // Derived, not stored: when the shift ends the prop goes null and the stale
  // elapsed value must not linger. Cheaper than another state write.
  return sinceIso ? elapsedMs : null;
}

/**
 * Past this, a running shift is almost certainly a forgotten clock-out rather
 * than a long day. Shared so the jobs list and the clock screen agree on when
 * to go amber.
 */
export const STALE_SHIFT_MS = 10 * 3_600_000;

/**
 * Whole minutes a running shift is past its scheduled end, or 0 if it isn't.
 *
 * Must stay identical to sendShiftClockOutReminders in src/lib/automations.ts:
 *
 *     expectedEnd = max(scheduledStart, clockIn) + length
 *
 * The max() is load-bearing in both directions. Anchoring to clock-in alone
 * invents an overrun for anyone who starts early — 42% of real entries do —
 * and the card would then contradict the scheduled window printed directly
 * beneath it. Anchoring to the scheduled start alone would cut short someone
 * who started late. Whole minutes, not milliseconds, so the label can never
 * read "0m over".
 */
export function overrunMinutes({
  clockInMs,
  scheduledStartMs,
  scheduledMinutes,
  nowMs,
}: {
  clockInMs: number;
  scheduledStartMs: number;
  scheduledMinutes: number;
  nowMs: number;
}): number {
  const expectedEndMs =
    Math.max(clockInMs, scheduledStartMs) + scheduledMinutes * 60_000;
  return Math.max(0, Math.floor((nowMs - expectedEndMs) / 60_000));
}
