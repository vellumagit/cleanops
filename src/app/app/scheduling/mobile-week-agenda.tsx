"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { zonedYmd, formatCalendarDate } from "@/lib/wall-clock";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import { WarningDot, WarningProvider } from "./warning-dot";
import type { ScheduleBooking, ScheduleEmployee } from "./data";
import type { BookingWarning } from "@/app/app/bookings/booking-warnings";

function formatTime(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function formatMins(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * The scheduling week, on a phone.
 *
 * WeekGrid is a cleaner x day matrix. A matrix needs width: on a 375px screen
 * the sticky name column eats ~140px and what is left shows about a day and a
 * half, so reading Thursday means scrolling sideways, and every card is
 * clipped mid-word ("Tetiana Kic...", "omji"). The lane partition shipped
 * earlier helps the week as a whole but not here — a cleaner with one job on
 * Monday keeps a lane open all week, and on a screen showing a day and a half
 * nearly every visible cell is still empty.
 *
 * Same answer the calendar reached (see calendar/mobile-week-view.tsx): swap
 * the axis. The strip carries the week's SHAPE — which day is heavy, which has
 * a hole — in about 90px. The detail comes from DayAgenda, the component the
 * day view already shows her on a phone, so tapping a day lands somewhere she
 * already knows how to read.
 *
 * One day at a time rather than seven stacked sections: the dispatcher's
 * question is "what is happening on this day and is anyone missing", and a
 * short answer with the strip still on screen beats a long scroll.
 *
 * Desktop is untouched — scheduler-shell renders this below sm and the grid
 * above, the same split the day view already uses.
 */

/** Derived from the date, not a Monday-indexed table — the parent decides
 *  where the week starts and a hardcoded list silently mislabels any other
 *  convention. */
const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

type DayBucket = {
  ymd: string;
  date: Date;
  bookings: ScheduleBooking[];
  minutes: number;
  unstaffed: number;
};

export function MobileWeekAgenda({
  weekStart,
  bookings,
  employees,
  warnings = {},
  tz,
  holidays = {},
}: {
  /** ISO date YYYY-MM-DD for the first day of the displayed week. */
  weekStart: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  warnings?: Record<string, BookingWarning[]> | Map<string, BookingWarning[]>;
  tz: string;
  holidays?: Record<string, string>;
}) {
  // membership_id → name, for the crew line on each row.
  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name])),
    [employees],
  );
  const buckets: DayBucket[] = useMemo(() => {
    const [y, m, d] = weekStart.split("-").map(Number);
    const days = Array.from(
      { length: 7 },
      (_, i) => new Date(y, m - 1, d + i),
    );
    // Bucket on the ORG's day, not the viewer's — a 10pm job must not slide
    // onto tomorrow for someone reading it from another province.
    const byYmd = new Map<string, ScheduleBooking[]>();
    for (const b of bookings) {
      const key = zonedYmd(new Date(b.scheduled_at), tz);
      const arr = byYmd.get(key);
      if (arr) arr.push(b);
      else byYmd.set(key, [b]);
    }
    return days.map((date) => {
      // The grid keys its cells off local calendar squares built from
      // weekStart, so build the same string here rather than zoning `date`
      // (which is a square, not an instant — zoning it slides it a day).
      const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const dayBookings = byYmd.get(ymd) ?? [];
      return {
        ymd,
        date,
        bookings: dayBookings,
        minutes: dayBookings.reduce((n, b) => n + (b.duration_minutes || 0), 0),
        // `staffed` is the shared rule — assignee OR crew OR a claimed bench
        // offer — so this dot agrees with the coverage banner.
        unstaffed: dayBookings.filter((b) => !b.staffed).length,
      };
    });
  }, [weekStart, bookings, tz]);

  const todayYmd = zonedYmd(new Date(), tz);
  const [selected, setSelected] = useState<string>(() => {
    // Land on today when the week contains it; otherwise the first day with
    // work, so opening a past or future week shows something rather than an
    // empty Monday.
    if (buckets.some((b) => b.ymd === todayYmd)) return todayYmd;
    return (buckets.find((b) => b.bookings.length > 0) ?? buckets[0]).ymd;
  });

  const busiest = Math.max(1, ...buckets.map((b) => b.minutes));
  const current = buckets.find((b) => b.ymd === selected) ?? buckets[0];
  const crewOnDay = new Set(
    current.bookings.flatMap((b) =>
      b.all_assignee_ids?.length
        ? b.all_assignee_ids
        : b.assigned_to
          ? [b.assigned_to]
          : [],
    ),
  ).size;

  return (
    <div className="flex flex-col">
      {/* ── The week's shape ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 grid grid-cols-7 gap-0.5 rounded-t-lg border border-border bg-card px-1 pb-1.5 pt-1">
        {buckets.map((b) => {
          const isSelected = b.ymd === selected;
          const isToday = b.ymd === todayYmd;
          const height =
            b.minutes === 0 ? 3 : Math.max(4, (b.minutes / busiest) * 22);
          return (
            <button
              key={b.ymd}
              type="button"
              onClick={() => setSelected(b.ymd)}
              aria-pressed={isSelected}
              aria-label={`${formatCalendarDate(b.date, { weekday: "long", month: "short", day: "numeric" })} — ${b.bookings.length} job${b.bookings.length === 1 ? "" : "s"}${b.unstaffed ? `, ${b.unstaffed} unassigned` : ""}`}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md py-1.5 transition-colors",
                isSelected ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {DAY_INITIALS[b.date.getDay()]}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  isSelected && "bg-foreground text-background",
                  !isSelected && isToday && "ring-1 ring-foreground",
                )}
              >
                {b.date.getDate()}
              </span>
              {/* Bottom-aligned inside a fixed track so the counts below sit on
                  one baseline instead of stair-stepping with the bars. */}
              <span className="flex h-6 w-3 items-end">
                <span
                  className={cn(
                    "w-full rounded-full",
                    b.minutes === 0 ? "bg-border" : "bg-foreground/70",
                  )}
                  style={{ height: `${height}px` }}
                />
              </span>
              <span className="flex h-3 items-center gap-0.5">
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {b.bookings.length || "—"}
                </span>
                {/* The dispatcher's whole reason for scanning the week: which
                    day still has a hole in it. */}
                {b.unstaffed > 0 && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-500"
                    aria-hidden
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── The selected day ───────────────────────────────────────────── */}
      <div className="rounded-b-lg border border-t-0 border-border bg-card px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          {formatCalendarDate(current.date, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
          {/* A stat holiday changes who is willing to work and what the client
              expects. The desk grid prints it above the columns; the phone had
              no equivalent until now. */}
          {holidays[current.ymd] && (
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              {holidays[current.ymd]}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {current.bookings.length === 0 ? (
            "Nothing scheduled"
          ) : (
            <>
              {current.bookings.length}{" "}
              {current.bookings.length === 1 ? "job" : "jobs"}
              {crewOnDay > 0 && (
                <>
                  {" · "}
                  {crewOnDay} {crewOnDay === 1 ? "cleaner" : "cleaners"}
                </>
              )}
              {current.unstaffed > 0 && (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {" · "}
                  {current.unstaffed} unassigned
                </span>
              )}
            </>
          )}
        </p>
      </div>

      {/* ── The day's jobs, as a list ──────────────────────────────────── */}
      {/* Deliberately NOT DayAgenda. That is a 24-hour time grid, and its job
          is placing work into gaps — "tap any empty time to book it" only
          makes sense against an hour axis. Scanning is the opposite problem:
          three jobs against 24 hours is a screen and a half of empty rows to
          scroll past, which is the vertical version of the sideways scroll
          this view exists to remove. The day view keeps the grid; the week
          gets the list. */}
      <WarningProvider warnings={warnings}>
        <ul className="mt-3 space-y-2">
          {current.bookings
            .slice()
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
            .map((b) => {
              const crew = (
                b.all_assignee_ids?.length
                  ? b.all_assignee_ids
                  : b.assigned_to
                    ? [b.assigned_to]
                    : []
              )
                .map((id) => nameById.get(id))
                .filter(Boolean) as string[];
              return (
                <li key={b.id}>
                  <Link
                    href={`/app/bookings/${b.id}`}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors active:bg-muted"
                  >
                    {/* Time rail: the one thing you scan down. tabular-nums so
                        the colons line up between rows. */}
                    <span className="w-[4.5rem] shrink-0 pt-0.5">
                      <span className="block text-sm font-semibold tabular-nums">
                        {formatTime(b.scheduled_at, tz)}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatMins(b.duration_minutes)}
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {b.client_name}
                        </span>
                        <WarningDot bookingId={b.id} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {crew.length > 0 ? (
                          crew.join(", ")
                        ) : (
                          <span className="font-medium text-amber-600 dark:text-amber-400">
                            Unassigned
                          </span>
                        )}
                      </span>
                      {b.address && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                          {b.address}
                        </span>
                      )}
                    </span>

                    <span className="shrink-0 pt-0.5">
                      <StatusBadge tone={bookingStatusTone(b.status)}>
                        {humanizeEnum(b.status)}
                      </StatusBadge>
                    </span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </WarningProvider>

      {current.bookings.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing scheduled on this day.
        </p>
      )}
    </div>
  );
}
