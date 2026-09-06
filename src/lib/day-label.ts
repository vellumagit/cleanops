import { zonedYmd } from "@/lib/wall-clock";

/**
 * The day, said the way a person says it.
 *
 * "Sep 26, 2026 · 3:00 PM" is correct and nobody reads it. On a phone in a
 * doorway what matters is whether this card is TODAY. Anna (2026-09-05) had
 * two visits for the same client three weeks apart, both printed in the
 * same small grey line under the name, and confirmed the wrong one.
 *
 *   today      → "Today"
 *   tomorrow   → "Tomorrow"
 *   this week  → "Thursday"
 *   further    → "Sat Sep 26"
 *   past       → "Yesterday" / "Mon Sep 1"
 */
export type DayLabel = {
  /** "Today" | "Tomorrow" | "Thursday" | "Sat Sep 26" | "Yesterday" | "Mon Sep 1" */
  day: string;
  /** "3:00 PM" */
  time: string;
  isToday: boolean;
  /** Calendar days from today in the org's zone: 0 today, 1 tomorrow, -1 yesterday. */
  daysAway: number;
};

function ymdToUtcNoon(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

export function dayLabel(
  iso: string,
  tz: string,
  now: Date = new Date(),
): DayLabel {
  const when = new Date(iso);
  const time = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const thatYmd = zonedYmd(when, tz);
  const todayYmd = zonedYmd(now, tz);
  const daysAway = Math.round(
    (ymdToUtcNoon(thatYmd) - ymdToUtcNoon(todayYmd)) / 86_400_000,
  );

  let day: string;
  if (daysAway === 0) day = "Today";
  else if (daysAway === 1) day = "Tomorrow";
  else if (daysAway === -1) day = "Yesterday";
  else if (daysAway > 1 && daysAway < 7) {
    day = when.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
  } else {
    // Built by hand: the locale form is "Sat, Sep 26" and the comma reads as
    // two things. On a chip it is one thing.
    const weekday = when.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
    const monthDay = when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz });
    day = `${weekday} ${monthDay}`;
  }
  return { day, time, isToday: daysAway === 0, daysAway };
}
