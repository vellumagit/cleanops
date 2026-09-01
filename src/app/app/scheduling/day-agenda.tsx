"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import type { ScheduleBooking, ScheduleEmployee } from "./data";
import { BookingQuickView } from "./booking-quick-view";
import { toneForEmployee } from "./color";
import type { BookingWarning } from "@/app/app/bookings/booking-warnings";
import { WarningDot, WarningProvider } from "./warning-dot";

/**
 * The phone's day view: ONE time lane for the whole operation.
 *
 * The dispatch grid answers "who is where" with a column per employee —
 * indispensable at a desk, unreadable on a phone. The first mobile pass
 * compressed the day into a list, which lost the thing Brian actually
 * manages by: TIME. A 10:30–2:30 job should LOOK four hours tall, and
 * every empty half-hour of the day should be one tap from a new booking —
 * before, after, or between jobs, not only in gaps the list deigned to
 * render.
 *
 * So: the dispatch grid's time axis, collapsed to a single lane. Bookings
 * are blocks spanning their duration (overlapping jobs share the lane
 * side-by-side, calendar-style); every 30-minute slot of empty background
 * is a tap target that pre-fills a new booking at that time; tapping a
 * block opens the same quick view the grids use. sm+ keeps the full
 * dispatch board untouched.
 */

const SLOT_MINUTES = 30;
const SLOT_PX = 40; // same scale as the dispatch grid: 1h = 80px
const SLOTS_PER_DAY = 48;
const DAY_HEIGHT_PX = SLOTS_PER_DAY * SLOT_PX;

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

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function timeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${pad(m)} ${suffix}`;
}

/**
 * Calendar-style lane packing for overlapping jobs: each booking gets a
 * lane within its overlap cluster and the cluster's total lane count, so
 * two simultaneous jobs render side-by-side at half width instead of one
 * hiding the other.
 */
function layoutLanes(
  items: Array<{ id: string; startMin: number; endMin: number }>,
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const id of cluster) out.get(id)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMin);
    } else {
      laneEnds[lane] = it.endMin;
    }
    out.set(it.id, { lane, lanes: 0 });
    cluster.push(it.id);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // Set post-mount so SSR and the first client render agree (null = no line).
  const [nowMin, setNowMin] = useState<number | null>(null);

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

  const positioned = useMemo(() => {
    const items = dayBookings.map((b) => {
      const startMin = minutesOfDay(b.scheduled_at, tz);
      return {
        id: b.id,
        startMin,
        // Same floor the dispatch grid applies: a 15-minute job still gets
        // one full slot so it's readable and tappable.
        endMin: startMin + Math.max(b.duration_minutes, SLOT_MINUTES),
      };
    });
    const lanes = layoutLanes(items);
    return items.map((it) => ({ ...it, ...lanes.get(it.id)! }));
  }, [dayBookings, tz]);

  // Auto-scroll to ~6 AM (cleaning mornings), or just before now for today —
  // mirrors the dispatch grid.
  useEffect(() => {
    const isToday = dateKey(new Date(), tz) === date;
    if (isToday) {
      const d = new Date();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe by design: the now-line only exists client-side, set once post-mount
      setNowMin(minutesOfDay(d.toISOString(), tz));
    }
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const anchorHour = isToday ? Math.max(0, new Date().getHours() - 1) : 6;
    el.scrollTop = anchorHour * 2 * SLOT_PX;
    didInitialScroll.current = true;
  }, [date, tz]);

  function addAt(minutes: number) {
    if (!canEdit) return;
    const hhmm = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    // Same "local ISO" contract the dispatch grid's slot click uses — the
    // new-booking page reinterprets it in the org tz.
    router.push(
      `/app/bookings/new?scheduled_at=${encodeURIComponent(`${date}T${hhmm}:00Z`)}`,
    );
  }

  return (
    <WarningProvider warnings={warnings}>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {holidayName && (
          <div className="border-b border-border bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            {holidayName}
          </div>
        )}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>
            {dayBookings.length === 0
              ? "Nothing scheduled"
              : `${dayBookings.length} job${dayBookings.length === 1 ? "" : "s"}`}
          </span>
          {canEdit && <span>Tap any empty time to book it</span>}
        </div>

        <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
          <div className="relative flex" style={{ height: DAY_HEIGHT_PX }}>
            {/* Hour gutter */}
            <div className="relative w-[54px] shrink-0 border-r border-border bg-card">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute right-1.5 text-[10px] leading-none text-muted-foreground"
                  style={{ top: hour * 2 * SLOT_PX }}
                >
                  {hour === 0 ? (
                    <span className="block pt-0.5">{formatHourLabel(hour)}</span>
                  ) : (
                    <span className="block -translate-y-1/2 rounded bg-card px-1">
                      {formatHourLabel(hour)}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* The one lane */}
            <div className="relative flex-1">
              {/* Tappable 30-min slots — the "book any moment" surface. */}
              {Array.from({ length: SLOTS_PER_DAY }, (_, slotIdx) => {
                const minutes = slotIdx * SLOT_MINUTES;
                return (
                  <div
                    key={slotIdx}
                    onClick={canEdit ? () => addAt(minutes) : undefined}
                    className={cn(
                      "group relative",
                      minutes % 60 === 0
                        ? "border-t border-border"
                        : "border-t border-border/30",
                      canEdit && "cursor-pointer active:bg-muted/50",
                    )}
                    style={{ height: SLOT_PX }}
                  >
                    {canEdit && (
                      // Faintly there on touch screens (no hover exists);
                      // hover-revealed on pointers. Same cue as dispatch.
                      <Plus
                        className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/0 transition-opacity group-hover:text-muted-foreground/60 pointer-coarse:text-muted-foreground/25"
                        aria-hidden
                      />
                    )}
                  </div>
                );
              })}

              {/* Now line — only when viewing today, only after mount. */}
              {nowMin != null && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-500/70"
                  style={{ top: (nowMin / SLOT_MINUTES) * SLOT_PX }}
                  aria-hidden
                >
                  <span className="absolute -top-[5px] left-0 h-2 w-2 rounded-full bg-red-500" />
                </div>
              )}

              {/* Booking blocks — height IS the duration. */}
              {positioned.map((pos) => {
                const b = bookingById.get(pos.id)!;
                const top = (pos.startMin / SLOT_MINUTES) * SLOT_PX;
                const height =
                  ((pos.endMin - pos.startMin) / SLOT_MINUTES) * SLOT_PX;
                const widthPct = 100 / pos.lanes;
                const assignees = (b.all_assignee_ids ?? [])
                  .map((id) => nameById.get(id))
                  .filter(Boolean) as string[];
                const lane = b.assigned_to
                  ? (laneById.get(b.assigned_to) ?? 0)
                  : 0;
                const cancelled = b.status === "cancelled";
                return (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuickViewId(b.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setQuickViewId(b.id);
                      }
                    }}
                    className={cn(
                      "absolute overflow-hidden rounded-md border-l-4 bg-background px-2 py-1 text-xs shadow-sm",
                      "cursor-pointer transition-colors hover:ring-1 hover:ring-foreground/30",
                      cancelled && "opacity-50",
                      !b.staffed && "ring-1 ring-amber-500/60",
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${pos.lane * widthPct}% + 4px)`,
                      width: `calc(${widthPct}% - 8px)`,
                      borderLeftColor: b.assigned_to
                        ? toneForEmployee(lane)
                        : "var(--border)",
                      zIndex: 2,
                    }}
                  >
                    <div className="flex items-center gap-1.5 font-semibold leading-tight">
                      <WarningDot bookingId={b.id} />
                      <span className="truncate">{b.client_name}</span>
                    </div>
                    <div className="truncate text-[10px] leading-tight text-muted-foreground">
                      {timeLabel(pos.startMin)} –{" "}
                      {timeLabel(pos.startMin + b.duration_minutes)}
                      {assignees.length > 0 ? (
                        <> · {assignees.join(", ")}</>
                      ) : b.staffed ? (
                        <> · Subcontractor</>
                      ) : (
                        <> · Unassigned</>
                      )}
                    </div>
                    {height >= SLOT_PX * 2 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <StatusBadge tone={bookingStatusTone(b.status)}>
                          {humanizeEnum(b.status)}
                        </StatusBadge>
                        {(b.all_assignee_ids?.length ?? 0) > 1 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                            title="Multi-crew booking"
                          >
                            <Users className="h-2.5 w-2.5" />
                            {b.all_assignee_ids!.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
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
