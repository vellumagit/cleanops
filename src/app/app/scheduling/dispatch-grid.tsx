"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import { rescheduleBookingAction } from "./actions";
import type { ScheduleBooking, ScheduleEmployee } from "./data";
import { BookingQuickView } from "./booking-quick-view";

/**
 * Dispatch view: single-day, time-of-day axis, employee columns.
 *
 *   Y-axis: 00:00 → 23:59 in 30-min slots (SLOT_PX pixels each)
 *   X-axis: one column per employee
 *   Bookings: absolutely positioned within the employee column based on
 *             their start time; height = duration. Click to open quick
 *             view, drag by the grip to move time / employee.
 *   Empty slots: clicking jumps to /app/bookings/new with the (employee,
 *                datetime) pre-filled so a new booking lands exactly
 *                where the owner clicked.
 *   Conflicts: bookings that overlap another booking on the SAME
 *              employee get a red border. Informational — the server
 *              still blocks hard conflict drops, but same-employee
 *              overlaps that arrived by other means (import, edit,
 *              cron) surface visually.
 */

const SLOT_MINUTES = 30;
const SLOT_PX = 40; // 30 min = 40px → hour = 80px
const SLOTS_PER_DAY = 48; // 24h × 2
const DAY_HEIGHT_PX = SLOTS_PER_DAY * SLOT_PX;

const LANE_TONES = [
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
  "#84cc16", // lime
];
const toneFor = (idx: number) => LANE_TONES[idx % LANE_TONES.length];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "2026-04-24" for a Date in the given tz. */
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

/** Minutes from midnight for a UTC iso, interpreted in the given tz. */
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

export function DispatchGrid({
  /** YYYY-MM-DD for the day this view renders. */
  date,
  bookings,
  employees,
  canEdit,
  tz,
  offDays = {},
}: {
  date: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  canEdit: boolean;
  tz: string;
  /** Employee → YYYY-MM-DD list they're off. If the current `date` is
   *  in an employee's list, their whole column is visually shaded +
   *  flagged in the header so the owner sees at a glance. */
  offDays?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const bookingById = useMemo(
    () => new Map(bookings.map((b) => [b.id, b])),
    [bookings],
  );

  // Set of employee ids who are off on the currently-viewed date. We
  // flatten once up front so the per-column render is O(1).
  const offEmployeeIds = useMemo(() => {
    const s = new Set<string>();
    for (const [empId, dates] of Object.entries(offDays)) {
      if (dates.includes(date)) s.add(empId);
    }
    return s;
  }, [offDays, date]);

  // Bucket bookings by employee, filtered to the day we're rendering.
  // Iterate every assignee (primary + additional crew from
  // booking_assignees) so shared jobs appear in each of their columns,
  // not just the primary's.
  const bookingsByEmployee = useMemo(() => {
    const map = new Map<string, ScheduleBooking[]>();
    for (const b of bookings) {
      if (dateKey(new Date(b.scheduled_at), tz) !== date) continue;
      const assignees = b.all_assignee_ids?.length
        ? b.all_assignee_ids
        : b.assigned_to
          ? [b.assigned_to]
          : [];
      for (const empId of assignees) {
        const arr = map.get(empId) ?? [];
        arr.push(b);
        map.set(empId, arr);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    }
    return map;
  }, [bookings, date, tz]);

  // Compute overlap conflicts per employee. O(n log n) total across all
  // employees — n is small (most cleaners have <10 jobs a day).
  const conflictIds = useMemo(() => {
    const flagged = new Set<string>();
    for (const list of bookingsByEmployee.values()) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const aStart = minutesOfDay(a.scheduled_at, tz);
        const aEnd = aStart + a.duration_minutes;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const bStart = minutesOfDay(b.scheduled_at, tz);
          if (bStart >= aEnd) break;
          const bEnd = bStart + b.duration_minutes;
          if (bStart < aEnd && bEnd > aStart) {
            flagged.add(a.id);
            flagged.add(b.id);
          }
        }
      }
    }
    return flagged;
  }, [bookingsByEmployee, tz]);

  // Auto-scroll to ~6 AM on mount (cleaning shifts start early). Or to
  // 2h before the current time when viewing today.
  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const today = dateKey(new Date(), tz);
    const anchorHour =
      date === today ? Math.max(0, new Date().getHours() - 1) : 6;
    el.scrollTop = anchorHour * 2 * SLOT_PX;
    didInitialScroll.current = true;
  }, [date, tz]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const bookingId = String(active.id);
    const target = parseDroppableId(String(over.id));
    if (!target) return;

    const booking = bookingById.get(bookingId);
    if (!booking) return;

    if (target.kind === "unassigned") {
      if (!booking.assigned_to) return; // already there
      startTransition(async () => {
        const result = await rescheduleBookingAction(
          bookingId,
          null,
          date,
        );
        if (result.ok) {
          toast.success("Moved to unassigned");
          router.refresh();
        } else {
          toast.error(result.error);
        }
      });
      return;
    }

    // Slot drop: (employee, HH:MM). No-op when it's already there.
    const currentMin = minutesOfDay(booking.scheduled_at, tz);
    const currentHH = `${pad(Math.floor(currentMin / 60))}:${pad(currentMin % 60)}`;
    if (
      booking.assigned_to === target.employeeId &&
      currentHH === target.time &&
      dateKey(new Date(booking.scheduled_at), tz) === date
    ) {
      return;
    }

    startTransition(async () => {
      const result = await rescheduleBookingAction(
        bookingId,
        target.employeeId,
        date,
        target.time,
      );
      if (result.ok) {
        toast.success("Rescheduled");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSlotClick(employeeId: string, minutesFromMidnight: number) {
    if (!canEdit) return;
    const h = Math.floor(minutesFromMidnight / 60);
    const m = minutesFromMidnight % 60;
    const hhmm = `${pad(h)}:${pad(m)}`;
    // Construct a "local" ISO — the new-booking page re-interprets this
    // via the org tz to produce the correct datetime-local string for
    // the form. Using Z suffix plus tz-aware reinterpretation avoids
    // double-shifting.
    const isoLike = `${date}T${hhmm}:00Z`;
    router.push(
      `/app/bookings/new?assigned_to=${employeeId}&scheduled_at=${encodeURIComponent(isoLike)}`,
    );
  }

  const activeBooking = activeId ? bookingById.get(activeId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Header row — employee names pinned at the top */}
        <div
          className="grid border-b border-border bg-muted/30"
          style={{
            gridTemplateColumns: `60px repeat(${Math.max(employees.length, 1)}, minmax(140px, 1fr))`,
          }}
        >
          <div className="border-r border-border px-2 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Time
          </div>
          {employees.length === 0 ? (
            <div className="px-4 py-2 text-sm text-muted-foreground">
              No active employees.
            </div>
          ) : (
            employees.map((emp, idx) => {
              const isOff = offEmployeeIds.has(emp.id);
              return (
                <div
                  key={emp.id}
                  className={cn(
                    "border-r border-border px-3 py-2 last:border-r-0",
                    isOff && "bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: toneFor(idx) }}
                    />
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        isOff && "text-muted-foreground line-through",
                      )}
                    >
                      {emp.name}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {isOff
                      ? "Off today"
                      : `${bookingsByEmployee.get(emp.id)?.length ?? 0} jobs`}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Scrollable time grid */}
        <div ref={scrollRef} className="max-h-[72vh] overflow-y-auto">
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `60px repeat(${Math.max(employees.length, 1)}, minmax(140px, 1fr))`,
              height: DAY_HEIGHT_PX,
            }}
          >
            {/* Time gutter — labels positioned at each hour boundary */}
            <div className="relative border-r border-border">
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

            {/* Employee columns */}
            {employees.map((emp, idx) => (
              <EmployeeColumn
                key={emp.id}
                employee={emp}
                tone={toneFor(idx)}
                bookings={bookingsByEmployee.get(emp.id) ?? []}
                conflictIds={conflictIds}
                canEdit={canEdit}
                tz={tz}
                date={date}
                isOff={offEmployeeIds.has(emp.id)}
                onQuickView={setQuickViewId}
                onSlotClick={handleSlotClick}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeBooking ? (
          <div className="rounded-md border border-border bg-background px-2 py-1.5 text-xs shadow-lg ring-2 ring-primary">
            <div className="font-semibold">{activeBooking.client_name}</div>
            <div className="text-muted-foreground">
              {activeBooking.duration_minutes}m
            </div>
          </div>
        ) : null}
      </DragOverlay>

      <BookingQuickView
        booking={quickViewId ? bookingById.get(quickViewId) ?? null : null}
        employees={employees}
        open={!!quickViewId}
        onOpenChange={(o) => !o && setQuickViewId(null)}
        tz={tz}
      />
    </DndContext>
  );
}

type DropTarget =
  | { kind: "cell"; employeeId: string; time: string }
  | { kind: "unassigned" };

function parseDroppableId(id: string): DropTarget | null {
  if (id === "unassigned") return { kind: "unassigned" };
  if (id.startsWith("slot:")) {
    const [, employeeId, time] = id.split(":");
    const [h, m] = time?.split("-") ?? [];
    if (employeeId && h && m) {
      return { kind: "cell", employeeId, time: `${h}:${m}` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Employee column — droppable slots + absolutely-positioned booking cards
// ---------------------------------------------------------------------------

function EmployeeColumn({
  employee,
  tone,
  bookings,
  conflictIds,
  canEdit,
  tz,
  date,
  isOff,
  onQuickView,
  onSlotClick,
}: {
  employee: ScheduleEmployee;
  tone: string;
  bookings: ScheduleBooking[];
  conflictIds: Set<string>;
  canEdit: boolean;
  tz: string;
  date: string;
  /** Employee is off today — whole column gets a striped background
   *  + the header says "Off today". Slots are still droppable (server
   *  is the source of truth on whether the drop is allowed). */
  isOff: boolean;
  onQuickView: (id: string) => void;
  onSlotClick: (employeeId: string, minutes: number) => void;
}) {
  return (
    <div
      className={cn(
        "relative border-r border-border last:border-r-0",
        isOff &&
          "bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(0,0,0,0.04)_10px,rgba(0,0,0,0.04)_20px)] dark:bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(255,255,255,0.04)_10px,rgba(255,255,255,0.04)_20px)]",
      )}
    >
      {/* Slot grid — lines every 30 min, thicker every hour */}
      {Array.from({ length: SLOTS_PER_DAY }, (_, slotIdx) => {
        const minutes = slotIdx * SLOT_MINUTES;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return (
          <DroppableSlot
            key={slotIdx}
            employeeId={employee.id}
            time={`${pad(h)}-${pad(m)}`}
            canEdit={canEdit}
            isHourStart={m === 0}
            onClick={() => onSlotClick(employee.id, minutes)}
          />
        );
      })}

      {/* Absolutely-positioned booking cards. Rendered after slots so
          they sit on top in the DOM and catch clicks before the slot
          beneath them. */}
      {bookings.map((b) => {
        const startMin = minutesOfDay(b.scheduled_at, tz);
        const top = (startMin / SLOT_MINUTES) * SLOT_PX;
        const height = Math.max(
          (b.duration_minutes / SLOT_MINUTES) * SLOT_PX,
          SLOT_PX, // at least 1 slot so short jobs are clickable
        );
        return (
          <PositionedBooking
            key={b.id}
            booking={b}
            top={top}
            height={height}
            tone={tone}
            canEdit={canEdit}
            hasConflict={conflictIds.has(b.id)}
            onQuickView={onQuickView}
          />
        );
      })}

      {/* Unused but keeps `date` on the hook dependency if we later want
          per-column empty-state UI. */}
      {bookings.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0" aria-hidden>
          {date}
        </div>
      )}
    </div>
  );
}

function DroppableSlot({
  employeeId,
  time,
  canEdit,
  isHourStart,
  onClick,
}: {
  employeeId: string;
  time: string; // "HH-MM"
  canEdit: boolean;
  isHourStart: boolean;
  onClick: () => void;
}) {
  const id = `slot:${employeeId}:${time}`;
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canEdit });

  return (
    <div
      ref={setNodeRef}
      onClick={canEdit ? onClick : undefined}
      className={cn(
        "group relative",
        isHourStart ? "border-t border-border" : "border-t border-border/30",
        canEdit && "cursor-pointer hover:bg-muted/40",
        isOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
      style={{ height: SLOT_PX }}
    >
      {canEdit && (
        <Plus
          className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/0 transition-opacity group-hover:text-muted-foreground/60"
          aria-hidden
        />
      )}
    </div>
  );
}

function PositionedBooking({
  booking,
  top,
  height,
  tone,
  canEdit,
  hasConflict,
  onQuickView,
}: {
  booking: ScheduleBooking;
  top: number;
  height: number;
  tone: string;
  canEdit: boolean;
  hasConflict: boolean;
  onQuickView: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: booking.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onClick={(e) => {
        // Clicking the body (not the grip) opens the quick view.
        e.stopPropagation();
        onQuickView(booking.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onQuickView(booking.id);
        }
      }}
      className={cn(
        "absolute left-1 right-1 overflow-hidden rounded-md border-l-4 bg-background px-2 py-1 text-xs shadow-sm transition-colors",
        "cursor-pointer hover:ring-1 hover:ring-foreground/30",
        isDragging && "opacity-30",
        hasConflict &&
          "ring-2 ring-rose-500/70 ring-offset-1 ring-offset-background",
      )}
      style={{
        top,
        height,
        borderLeftColor: tone,
        zIndex: 2,
      }}
      title={`${booking.client_name} · ${humanizeEnum(booking.service_type)}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">
            {booking.client_name}
          </div>
          <div className="truncate text-[10px] leading-tight text-muted-foreground">
            {new Date(booking.scheduled_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              // we don't know tz here; the title shows full info anyway.
            })}{" "}
            · {booking.duration_minutes}m
          </div>
          {height >= SLOT_PX * 2 && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <StatusBadge tone={bookingStatusTone(booking.status)}>
                {humanizeEnum(booking.status)}
              </StatusBadge>
              {(booking.all_assignee_ids?.length ?? 0) > 1 && (
                <span
                  className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                  title="Multi-crew booking"
                >
                  👥 {booking.all_assignee_ids!.length}
                </span>
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            aria-label="Drag to reschedule"
            onClick={(e) => e.stopPropagation()}
            {...(listeners as DraggableSyntheticListeners)}
            className="shrink-0 rounded p-0.5 text-muted-foreground cursor-grab active:cursor-grabbing hover:bg-muted"
          >
            <GripVertical className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
