"use client";

import { useMemo, useRef, useState } from "react";
import {
  startOfWeek,
  addDays,
  isSameDay,
  isToday,
  format,
  differenceInMinutes,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "./page";

/**
 * The week, on a phone.
 *
 * WeekView is a 7-column x 24-hour time grid. On a 375px screen that leaves
 * ~45px per day — narrower than the two lines of text each chip tries to put
 * in it — and 24 x 56px = 1,344px of vertical grid. Svit's actual week is 15
 * jobs, 1-4 a day, every one starting between 9:00 and 15:00, so roughly
 * seventy percent of that scroll is permanently empty and the rest is
 * unreadable. A time grid pays for itself when days are dense and overlapping;
 * at two jobs a day it is all cost.
 *
 * So: swap the axis. The strip across the top carries the week's SHAPE — the
 * one thing the grid was actually for — in about 80px, and the agenda below
 * carries the detail the 45px chip could never show: who the client is, who is
 * on it, and whether anyone is on it at all.
 *
 * Desktop is untouched; calendar-view renders this below md and the grid above.
 */

type Props = {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
  onNewBooking: (slotIso?: string) => void;
  tz: string;
  /** Shared with WeekView so both read times in the org's zone. */
  fmtTime: (iso: string, tz: string, style: "h:mm a" | "h:mma" | "h:mm") => string;
};

/** A day's worth of events plus the numbers the strip needs. */
type DayBucket = {
  date: Date;
  key: string;
  events: CalendarEvent[];
  minutes: number;
};

function labelFor(ev: CalendarEvent): string {
  if (ev.type === "booking" || ev.type === "invoice") return ev.meta.client;
  return ev.title;
}

/** Who is on it — and, when nobody is, say so loudly. */
function assigneeOf(ev: CalendarEvent): string | null {
  if (ev.type === "booking") return ev.meta.employee;
  if (ev.type === "task") return ev.meta.assignee;
  return null;
}

export function MobileWeekView({
  currentDate,
  events,
  onSelectEvent,
  onNewBooking,
  tz,
  fmtTime,
}: Props) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const [focused, setFocused] = useState<string | null>(null);

  const buckets: DayBucket[] = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const dayEvents = events
        .filter((e) => isSameDay(new Date(e.start), date))
        .sort((a, b) => a.start.localeCompare(b.start));
      const minutes = dayEvents.reduce(
        (sum, e) =>
          sum + Math.max(differenceInMinutes(new Date(e.end), new Date(e.start)), 0),
        0,
      );
      return { date, key: date.toISOString().slice(0, 10), events: dayEvents, minutes };
    });
  }, [weekStart, events]);

  // Bars are relative to the busiest day, not to an absolute scale — the
  // question a glance asks is "which day is the heavy one", not "how many
  // hours exactly". A floor keeps an empty day visible as an empty day.
  const busiest = Math.max(...buckets.map((b) => b.minutes), 1);

  function jumpTo(key: string) {
    setFocused(key);
    dayRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col">
      {/* ── The week's shape ───────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 grid grid-cols-7 gap-1 border-b border-border bg-card px-1 pb-2 pt-1">
        {buckets.map((b) => {
          const today = isToday(b.date);
          const height = b.minutes === 0 ? 3 : Math.max(4, (b.minutes / busiest) * 26);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => jumpTo(b.key)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md py-1.5 transition-colors",
                focused === b.key ? "bg-muted" : "hover:bg-muted/50",
              )}
              aria-label={`${format(b.date, "EEEE d")} — ${b.events.length} job${b.events.length === 1 ? "" : "s"}`}
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {format(b.date, "EEEEE")}
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  today
                    ? "bg-foreground text-background"
                    : "text-foreground",
                )}
              >
                {format(b.date, "d")}
              </span>
              {/* Load bar, bottom-aligned inside a fixed track. Without the
                  track each bar's own height pushed the count below it to a
                  different baseline, so the row of numbers stair-stepped. */}
              <span className="flex h-7 w-4 items-end">
                <span
                  className={cn(
                    "w-full rounded-full",
                    b.minutes === 0 ? "bg-border" : "bg-foreground/70",
                  )}
                  style={{ height: `${height}px` }}
                />
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {b.events.length || "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── The detail ─────────────────────────────────────────────────── */}
      <div className="divide-y divide-border">
        {buckets.map((b) => (
          <section
            key={b.key}
            ref={(el) => {
              dayRefs.current[b.key] = el;
            }}
            className="scroll-mt-24"
          >
            <header className="flex items-baseline justify-between px-3 py-2">
              <span
                className={cn(
                  "text-sm font-semibold",
                  isToday(b.date) ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {format(b.date, "EEEE")}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {format(b.date, "MMM d")}
                </span>
              </span>
              {b.events.length > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {b.events.length} · {Math.round((b.minutes / 60) * 10) / 10}h
                </span>
              )}
            </header>

            {b.events.length === 0 ? (
              <button
                type="button"
                onClick={() => onNewBooking(b.date.toISOString())}
                className="w-full px-3 pb-3 text-left text-xs text-muted-foreground/70"
              >
                Nothing booked — tap to add
              </button>
            ) : (
              <ul className="pb-2">
                {b.events.map((ev) => {
                  const who = assigneeOf(ev);
                  const unassigned = ev.type === "booking" && !who;
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => onSelectEvent(ev)}
                        className="flex w-full items-stretch gap-2.5 px-3 py-2 text-left active:bg-muted/50"
                      >
                        {/* Status rail — the colour the grid used, given room
                            to be read as a category rather than a chip fill. */}
                        <span
                          aria-hidden
                          className="w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {labelFor(ev)}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {fmtTime(ev.start, tz, "h:mm")}–{fmtTime(ev.end, tz, "h:mma")}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            {unassigned ? (
                              <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                                Unassigned
                              </span>
                            ) : who ? (
                              <span className="truncate">{who}</span>
                            ) : null}
                            {ev.type === "booking" && ev.meta.service_type && (
                              <span className="truncate">
                                {who || unassigned ? "· " : ""}
                                {ev.meta.service_type}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
