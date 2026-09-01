"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import type {
  ScheduleBooking,
  ScheduleEmployee,
} from "./data";
import { BookingQuickView } from "./booking-quick-view";
import { toneForEmployee } from "./color";
import type { BookingWarning } from "@/app/app/bookings/booking-warnings";
import { WarningDot, WarningProvider } from "./warning-dot";

/**
 * The phone's day view: one chronological list of what's happening today.
 *
 * The dispatch grid answers "who is where" with a column per employee —
 * indispensable at a desk, unreadable on a phone, where the question is
 * simply "what's scheduled today?". So on small screens the day view is an
 * AGENDA: each job is one row ("4:00 PM · Leslie Saumer · Brian"), a gap
 * between jobs is a tappable free slot that pre-fills a new booking at that
 * time, and tapping a job opens the same quick view the grids use. The
 * grid is untouched on sm+ — this is a different rendering of the same
 * data, not a replacement for dispatch.
 */

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function minutesOfDay(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function timeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${pad(m)} ${suffix}`;
}

/** Next :00/:30 at or after `minutes`, clamped to the last slot of the day. */
function roundUpToSlot(minutes: number): number {
  return Math.min(Math.ceil(minutes / 30) * 30, 23 * 60 + 30);
}

export function DayAgenda({
  date,
  bookings,
  employees,
  warnings = {},
  canEdit,
  canEditStatus,
  tz,
  holidayName = null,
}: {
  /** YYYY-MM-DD for the day this view renders. */
  date: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  warnings?: Record<string, BookingWarning[]> | Map<string, BookingWarning[]>;
  canEdit: boolean;
  canEditStatus: boolean;
  tz: string;
  /** Statutory holiday name for this day, if any. */
  holidayName?: string | null;
}) {
  const router = useRouter();
  const [quickViewId, setQuickViewId] = useState<string | null>(null);

  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name])),
    [employees],
  );
  const laneById = useMemo(
    () => new Map(employees.map((e, i) => [e.id, i])),
    [employees],
  );

  const dayBookings = useMemo(
    () =>
      bookings
        .filter((b) => dateKey(new Date(b.scheduled_at), tz) === date)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [bookings, date, tz],
  );

  const bookingById = useMemo(
    () => new Map(dayBookings.map((b) => [b.id, b])),
    [dayBookings],
  );

  function addAt(minutes: number) {
    if (!canEdit) return;
    const hhmm = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    // Same "local ISO" contract the dispatch grid's slot click uses — the
    // new-booking page reinterprets it in the org tz.
    router.push(
      `/app/bookings/new?scheduled_at=${encodeURIComponent(`${date}T${hhmm}:00Z`)}`,
    );
  }

  // Interleave jobs with tappable free slots. `cursor` tracks the latest
  // end time seen so far, so overlapping jobs don't produce phantom gaps.
  const rows: Array<
    | { kind: "booking"; booking: ScheduleBooking }
    | { kind: "gap"; startMin: number; minutes: number }
  > = [];
  let cursor: number | null = null;
  for (const b of dayBookings) {
    const startMin = minutesOfDay(b.scheduled_at, tz);
    if (cursor != null && startMin - cursor >= 60) {
      rows.push({ kind: "gap", startMin: cursor, minutes: startMin - cursor });
    }
    rows.push({ kind: "booking", booking: b });
    cursor = Math.max(cursor ?? 0, startMin + b.duration_minutes);
  }

  return (
    <WarningProvider warnings={warnings}>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {holidayName && (
          <div className="border-b border-border bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            {holidayName}
          </div>
        )}
        {dayBookings.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing scheduled this day.
            </p>
            {canEdit && (
              <button
                type="button"
                onClick={() => addAt(9 * 60)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
                Add a booking
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((row, i) => {
              if (row.kind === "gap") {
                const at = roundUpToSlot(row.startMin);
                const h = Math.floor(row.minutes / 60);
                const m = row.minutes % 60;
                return (
                  <li key={`gap-${i}`}>
                    <button
                      type="button"
                      onClick={() => addAt(at)}
                      disabled={!canEdit}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground",
                        canEdit && "transition-colors hover:bg-muted/40",
                      )}
                    >
                      <span className="h-px flex-1 border-t border-dashed border-border" />
                      <span>
                        free {h > 0 ? `${h}h ` : ""}
                        {m > 0 ? `${m}m` : ""}
                      </span>
                      {canEdit && (
                        <span className="inline-flex items-center gap-0.5 font-medium text-foreground/70">
                          <Plus className="h-3 w-3" />
                          {timeLabel(at)}
                        </span>
                      )}
                      <span className="h-px flex-1 border-t border-dashed border-border" />
                    </button>
                  </li>
                );
              }

              const b = row.booking;
              const startMin = minutesOfDay(b.scheduled_at, tz);
              const endMin = startMin + b.duration_minutes;
              const assignees = (b.all_assignee_ids ?? [])
                .map((id) => nameById.get(id))
                .filter(Boolean) as string[];
              const lane = b.assigned_to
                ? (laneById.get(b.assigned_to) ?? 0)
                : 0;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setQuickViewId(b.id)}
                    className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <span
                      className="w-1 shrink-0 rounded-full"
                      style={{
                        backgroundColor: b.assigned_to
                          ? toneForEmployee(lane)
                          : "var(--border)",
                      }}
                      aria-hidden
                    />
                    <span className="w-16 shrink-0 pt-0.5 text-right">
                      <span className="block text-sm font-semibold tabular-nums leading-tight">
                        {timeLabel(startMin)}
                      </span>
                      <span className="block text-[10px] tabular-nums text-muted-foreground">
                        – {timeLabel(endMin)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                        <WarningDot bookingId={b.id} />
                        <span className="truncate">{b.client_name}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {humanizeEnum(b.service_type)}
                        {assignees.length > 0 ? (
                          <> · {assignees.join(", ")}</>
                        ) : b.staffed ? (
                          <> · Subcontractor</>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <StatusBadge tone={bookingStatusTone(b.status)}>
                          {humanizeEnum(b.status)}
                        </StatusBadge>
                        {!b.staffed && (
                          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            Unassigned
                          </span>
                        )}
                        {(b.all_assignee_ids?.length ?? 0) > 1 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title="Multi-crew booking"
                          >
                            <Users className="h-2.5 w-2.5" />
                            {b.all_assignee_ids!.length}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {canEdit && cursor != null && cursor < 23 * 60 && (
              <li>
                <button
                  type="button"
                  onClick={() => addAt(roundUpToSlot(cursor as number))}
                  className="flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add after {timeLabel(roundUpToSlot(cursor as number))}
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <BookingQuickView
        booking={quickViewId ? (bookingById.get(quickViewId) ?? null) : null}
        employees={employees}
        open={!!quickViewId}
        onOpenChange={(o) => !o && setQuickViewId(null)}
        tz={tz}
        canEditStatus={canEditStatus}
      />
    </WarningProvider>
  );
}
