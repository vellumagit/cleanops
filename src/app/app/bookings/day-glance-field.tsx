"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { getDayGlanceAction, type DayGlanceJob } from "./day-glance";

/**
 * The day, named — and what is already on it.
 *
 * Sits under the "Scheduled at" input. A datetime-local field on a phone is
 * a spinner: it never says which weekday you landed on, and it says nothing
 * about the day it is choosing. Svitlana, rescheduling on her phone: "I don't
 * see the day — Thursday, Monday, whatever… I wanna book on a particular day,
 * I can see if I have something there."
 *
 * So: the weekday spelled out, and the day's other jobs listed beneath it.
 * Read-only on purpose. Deciding whether a slot is free is the question being
 * asked here; the scheduler is still where you go to move things around.
 */

function timeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0
    ? `${h} ${suffix}`
    : `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function DayGlanceField({
  /** The form's datetime-local value, e.g. "2026-09-16T14:00". */
  value,
  /** Booking being edited, so it doesn't list itself as a clash. */
  excludeBookingId,
}: {
  value: string;
  excludeBookingId?: string;
}) {
  const dateYmd = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null;
  const [jobs, setJobs] = useState<DayGlanceJob[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!dateYmd) {
      setJobs(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Small debounce: a datetime-local fires per keystroke on desktop, and
    // the first two are usually a half-typed year.
    const t = setTimeout(async () => {
      const res = await getDayGlanceAction(dateYmd);
      if (cancelled) return;
      setJobs(res.ok ? res.jobs : []);
      setLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dateYmd]);

  if (!dateYmd) return null;

  // The weekday, from the wall-clock string itself. datetime-local carries no
  // zone and names the org's own clock, so the calendar date is exactly as
  // typed — no conversion, nothing to shift.
  // Built at UTC NOON and formatted in UTC, deliberately: this is a calendar
  // date with no time of day, so pinning both ends to the same zone makes the
  // weekday correct for every viewer. A local-zone Date here would tip over a
  // day for anyone east or west of the org.
  const [y, m, d] = dateYmd.split("-").map(Number);
  const named = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(
    "en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" },
  );

  const others = (jobs ?? []).filter((j) => j.id !== excludeBookingId);

  return (
    <div className="mt-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        {named}
      </p>

      {loading && jobs === null ? (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking that day…
        </p>
      ) : others.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Nothing else booked that day.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Already that day — {others.length} job
            {others.length === 1 ? "" : "s"}:
          </p>
          <ul className="mt-1 space-y-0.5">
            {others.map((j) => (
              <li key={j.id} className="flex gap-2 text-[11px]">
                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                  {timeLabel(j.startMinutes)}
                  {j.durationMinutes > 0 && (
                    <>–{timeLabel(j.startMinutes + j.durationMinutes)}</>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {j.clientName}
                  {j.who && (
                    <span className="text-muted-foreground"> · {j.who}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
