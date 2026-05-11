"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { bookingStatusTone } from "@/components/status-badge";
import type { ScheduleBooking, ScheduleEmployee } from "./data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns the Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0=Sun…6=Sat
  out.setDate(out.getDate() + (dow === 0 ? -6 : 1 - dow));
  return out;
}

/** Returns the Sunday (end of last row) of the calendar month starting at `first`. */
function lastCalendarDay(first: Date): Date {
  // last day of month
  const lastOfMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const dow = lastOfMonth.getDay();
  // advance to Sunday (or 0 more if already Sunday)
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  const out = new Date(lastOfMonth);
  out.setDate(out.getDate() + daysToSunday);
  return out;
}

/** Build calendar grid: array of weeks, each week is 7 days (Mon…Sun). */
function buildCalendarWeeks(monthYmd: string): Date[][] {
  const anchor = parseYMD(monthYmd);
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mondayOf(firstOfMonth);
  const gridEnd = lastCalendarDay(firstOfMonth);

  const weeks: Date[][] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Format a booking time in the given tz, e.g. "9:00 AM". */
function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
    hour12: true,
  });
}

/** Return the YYYY-MM-DD wall-clock date for a booking in the org tz. */
function bookingDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
    new Date(iso),
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Max chips to show before "+ N more" truncation
const MAX_CHIPS = 3;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Calendar month grid for the scheduling page.
 *
 * Each day cell shows up to MAX_CHIPS booking chips (client name + time).
 * Clicking a chip opens the booking's edit page. Clicking the day number
 * navigates to the Day view for that date. Off-days shade the employee's
 * column with a subtle grey — here we instead shade the cell lightly if
 * ANY employee on that org has an off-day (since we don't have per-employee
 * columns in month view).
 *
 * The grid is intentionally read-only (no drag-and-drop) — month view is
 * for overview, not heavy editing. Users switch to Week/Day for mutations.
 */
export function MonthGrid({
  monthYmd,
  bookings,
  employees,
  offDays,
  tz,
}: {
  /** Any YYYY-MM-DD within the target month. */
  monthYmd: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  offDays: Record<string, string[]>;
  tz: string;
}) {
  const router = useRouter();
  const anchor = parseYMD(monthYmd);
  const currentMonth = anchor.getMonth();
  const currentYear = anchor.getFullYear();
  const today = formatYMD(new Date());
  const weeks = buildCalendarWeeks(monthYmd);

  // Build a map: YYYY-MM-DD → ScheduleBooking[]
  const bookingsByDay = new Map<string, ScheduleBooking[]>();
  for (const b of bookings) {
    const key = bookingDateKey(b.scheduled_at, tz);
    const arr = bookingsByDay.get(key) ?? [];
    arr.push(b);
    bookingsByDay.set(key, arr);
  }

  // Sort each day's bookings by start time
  for (const arr of bookingsByDay.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
    );
  }

  // Build a set of dates with at least one off-day across any employee
  const offDaySet = new Set<string>();
  for (const dates of Object.values(offDays)) {
    for (const d of dates) offDaySet.add(d);
  }

  // Employee id → name map for tooltips
  const empMap = new Map(employees.map((e) => [e.id, e.name]));

  function goToDay(ymd: string) {
    router.push(`/app/scheduling?view=day&week=${ymd}`);
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {DAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar rows */}
      {weeks.map((week, wi) => (
        <div
          key={wi}
          className={cn(
            "grid grid-cols-7",
            wi < weeks.length - 1 && "border-b border-border",
          )}
        >
          {week.map((day, di) => {
            const ymd = formatYMD(day);
            const isCurrentMonth =
              day.getMonth() === currentMonth &&
              day.getFullYear() === currentYear;
            const isToday = ymd === today;
            const hasOffDay = offDaySet.has(ymd);
            const dayBookings = bookingsByDay.get(ymd) ?? [];
            const visible = dayBookings.slice(0, MAX_CHIPS);
            const overflow = dayBookings.length - visible.length;

            return (
              <div
                key={di}
                className={cn(
                  "min-h-[100px] p-1.5 relative",
                  // right border between columns (not after last)
                  di < 6 && "border-r border-border",
                  // dim out-of-month days
                  !isCurrentMonth && "bg-muted/20",
                  // subtle off-day tint
                  hasOffDay && isCurrentMonth && "bg-amber-50/30 dark:bg-amber-950/10",
                )}
              >
                {/* Day number — clicking goes to Day view */}
                <button
                  type="button"
                  onClick={() => goToDay(ymd)}
                  title={`Switch to day view for ${ymd}`}
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    isToday
                      ? "bg-foreground text-background"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground",
                    !isCurrentMonth && "opacity-40",
                  )}
                >
                  {day.getDate()}
                </button>

                {/* Booking chips */}
                <div className="space-y-0.5">
                  {visible.map((b) => {
                    const tone = bookingStatusTone(b.status);
                    const assigneeName = b.assigned_to
                      ? (empMap.get(b.assigned_to) ?? null)
                      : null;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() =>
                          router.push(`/app/bookings/${b.id}/edit`)
                        }
                        title={`${b.client_name}${assigneeName ? ` · ${assigneeName}` : ""} · ${b.status}`}
                        className={cn(
                          "w-full rounded px-1.5 py-0.5 text-left text-[11px] leading-tight truncate transition-opacity hover:opacity-80",
                          tone === "green" &&
                            "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
                          tone === "blue" &&
                            "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
                          tone === "amber" &&
                            "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
                          tone === "red" &&
                            "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                          tone === "neutral" &&
                            "bg-muted text-muted-foreground",
                        )}
                      >
                        <span className="font-medium">
                          {fmtTime(b.scheduled_at, tz)}
                        </span>{" "}
                        {b.client_name}
                      </button>
                    );
                  })}

                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={() => goToDay(ymd)}
                      className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      + {overflow} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
