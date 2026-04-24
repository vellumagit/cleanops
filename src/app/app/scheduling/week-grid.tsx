"use client";

import { useMemo, useState, useTransition } from "react";
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
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import { rescheduleBookingAction } from "./actions";
import type { ScheduleBooking, ScheduleEmployee } from "./data";
import { BookingQuickView } from "./booking-quick-view";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Lane background hues, indexed by employee position. */
const LANE_TONES = [
  "border-l-sky-500",
  "border-l-violet-500",
  "border-l-emerald-500",
  "border-l-amber-500",
  "border-l-rose-500",
  "border-l-cyan-500",
  "border-l-fuchsia-500",
  "border-l-lime-500",
];

function laneTone(idx: number) {
  return LANE_TONES[idx % LANE_TONES.length];
}

function dateKey(d: Date, tz?: string) {
  if (tz) {
    // Render the date components in the org's timezone so cellMap
    // bucketing matches what the user sees (e.g. a 10pm Edmonton job
    // stays on the same day it was scheduled for, not the next day
    // when the browser is in a later tz).
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHourMinute(iso: string, tz?: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });
}

type DropTarget =
  | { kind: "cell"; employeeId: string; date: string }
  | { kind: "unassigned" };

function parseDroppableId(id: string): DropTarget | null {
  if (id === "unassigned") return { kind: "unassigned" };
  if (id.startsWith("cell:")) {
    const [, employeeId, date] = id.split(":");
    if (employeeId && date) return { kind: "cell", employeeId, date };
  }
  return null;
}

export function WeekGrid({
  weekStart,
  bookings,
  employees,
  canEdit,
  /** "week" shows all 7 days, "day" collapses to just the first day of
   *  the range. The parent picks which via a toggle in the page header. */
  view = "week",
  /** Org IANA timezone. Used to bucket bookings into the correct cell
   *  and to format start times — so an 8am Edmonton booking shows as
   *  "8:00 AM" regardless of the viewer's browser tz. */
  tz,
}: {
  /** ISO date YYYY-MM-DD for Monday of the displayed week (or the day
   *  itself in day view). */
  weekStart: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  canEdit: boolean;
  view?: "week" | "day";
  tz: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Quick-view dialog state. Open by clicking a booking card; drag is
  // on a dedicated grip handle so click-to-open doesn't fight dnd-kit.
  const [quickViewId, setQuickViewId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const days = useMemo(() => {
    const [y, m, d] = weekStart.split("-").map(Number);
    const count = view === "day" ? 1 : 7;
    return Array.from({ length: count }, (_, i) => new Date(y, m - 1, d + i));
  }, [weekStart, view]);

  const bookingById = useMemo(
    () => new Map(bookings.map((b) => [b.id, b])),
    [bookings],
  );

  const unassigned = useMemo(
    () =>
      bookings
        .filter((b) => !b.assigned_to)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [bookings],
  );

  /** Map of `${employeeId}|${YYYY-MM-DD}` → bookings, for fast cell lookup. */
  const cellMap = useMemo(() => {
    const map = new Map<string, ScheduleBooking[]>();
    for (const b of bookings) {
      if (!b.assigned_to) continue;
      const k = `${b.assigned_to}|${dateKey(new Date(b.scheduled_at), tz)}`;
      const arr = map.get(k) ?? [];
      arr.push(b);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    }
    return map;
  }, [bookings]);

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

    // No-op: dropped where it already is.
    if (target.kind === "unassigned") {
      if (!booking.assigned_to) return;
    } else {
      const currentDate = dateKey(new Date(booking.scheduled_at), tz);
      if (
        booking.assigned_to === target.employeeId &&
        currentDate === target.date
      ) {
        return;
      }
    }

    const targetDate =
      target.kind === "unassigned"
        ? dateKey(new Date(booking.scheduled_at), tz)
        : target.date;
    const assignedTo = target.kind === "unassigned" ? null : target.employeeId;

    startTransition(async () => {
      const result = await rescheduleBookingAction(
        bookingId,
        assignedTo,
        targetDate,
      );
      if (result.ok) {
        toast.success(
          target.kind === "unassigned"
            ? "Moved to unassigned"
            : "Booking rescheduled",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const activeBooking = activeId ? bookingById.get(activeId) ?? null : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-6">
        <UnassignedTray
          bookings={unassigned}
          canEdit={canEdit}
          isPending={isPending}
          onQuickView={setQuickViewId}
          tz={tz}
        />

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <div
            className={cn(
              "grid",
              view === "day" ? "min-w-[360px]" : "min-w-[960px]",
            )}
            style={{
              gridTemplateColumns:
                view === "day"
                  ? `180px minmax(220px, 1fr)`
                  : `180px repeat(7, minmax(140px, 1fr))`,
            }}
          >
            <div className="sticky left-0 z-10 border-b border-r border-border bg-card px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cleaner
            </div>
            {days.map((d) => (
              <div
                key={d.toISOString()}
                className="border-b border-border px-3 py-3 text-center"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {DAY_LABELS[(d.getDay() + 6) % 7]}
                </div>
                <div className="text-sm font-medium tabular-nums">
                  {d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
            ))}

            {employees.length === 0 ? (
              <div
                className={cn(
                  "px-4 py-12 text-center text-sm text-muted-foreground",
                  view === "day" ? "col-span-2" : "col-span-8",
                )}
              >
                No active employees. Invite team members from Settings → Members.
              </div>
            ) : null}

            {employees.map((emp, idx) => (
              <EmployeeRow
                key={emp.id}
                employee={emp}
                tone={laneTone(idx)}
                days={days}
                cellMap={cellMap}
                canEdit={canEdit}
                onQuickView={setQuickViewId}
                tz={tz}
              />
            ))}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeBooking ? (
          <BookingCard booking={activeBooking} dragging tone="" />
        ) : null}
      </DragOverlay>

      <BookingQuickView
        booking={
          quickViewId ? bookingById.get(quickViewId) ?? null : null
        }
        employees={employees}
        open={!!quickViewId}
        onOpenChange={(o) => {
          if (!o) setQuickViewId(null);
        }}
        tz={tz}
      />
    </DndContext>
  );
}

function EmployeeRow({
  employee,
  tone,
  days,
  cellMap,
  canEdit,
  onQuickView,
  tz,
}: {
  employee: ScheduleEmployee;
  tone: string;
  days: Date[];
  cellMap: Map<string, ScheduleBooking[]>;
  canEdit: boolean;
  onQuickView: (bookingId: string) => void;
  tz: string;
}) {
  return (
    <>
      <div
        className={cn(
          "sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border bg-card px-4 py-3 text-sm font-medium",
          "border-l-4",
          tone,
        )}
      >
        {employee.name}
      </div>
      {days.map((d) => {
        const key = `${employee.id}|${dateKey(d)}`;
        const cellBookings = cellMap.get(key) ?? [];
        return (
          <DayCell
            key={key}
            employeeId={employee.id}
            date={dateKey(d)}
            bookings={cellBookings}
            canEdit={canEdit}
            onQuickView={onQuickView}
            tz={tz}
          />
        );
      })}
    </>
  );
}

function DayCell({
  employeeId,
  date,
  bookings,
  canEdit,
  onQuickView,
  tz,
}: {
  employeeId: string;
  date: string;
  bookings: ScheduleBooking[];
  canEdit: boolean;
  onQuickView: (bookingId: string) => void;
  tz: string;
}) {
  const droppableId = `cell:${employeeId}:${date}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[110px] space-y-2 border-b border-r border-border p-2 transition-colors",
        isOver && "bg-primary/5 ring-2 ring-inset ring-primary/40",
      )}
    >
      {bookings.map((b) => (
        <DraggableBooking
          key={b.id}
          booking={b}
          canEdit={canEdit}
          onQuickView={onQuickView}
          tz={tz}
        />
      ))}
    </div>
  );
}

/**
 * Booking card with separated drag + click zones.
 *
 * The whole card reacts to a left-click by opening the quick-view
 * dialog. The GripVertical icon is the ONLY drag handle — dnd-kit
 * pointer listeners are bound only to the grip, not the outer card.
 * This lets owners click to view/edit without accidentally kicking
 * off a drag (and vice versa).
 *
 * When canEdit is false (e.g. employee role), drag is disabled and
 * the grip is hidden — clicking still works.
 */
function DraggableBooking({
  booking,
  canEdit,
  onQuickView,
  tz,
}: {
  booking: ScheduleBooking;
  canEdit: boolean;
  onQuickView: (bookingId: string) => void;
  tz: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: booking.id,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      className={cn(isDragging && "opacity-30")}
    >
      <BookingCard
        booking={booking}
        tone=""
        canDrag={canEdit}
        onClick={() => onQuickView(booking.id)}
        dragListeners={listeners}
        tz={tz}
      />
    </div>
  );
}

function BookingCard({
  booking,
  tone,
  dragging = false,
  canDrag = false,
  onClick,
  dragListeners,
  tz,
}: {
  booking: ScheduleBooking;
  tone: string;
  dragging?: boolean;
  canDrag?: boolean;
  /** Fires on left-click anywhere on the card except the drag grip.
   *  Omit in the DragOverlay preview. */
  onClick?: () => void;
  /** dnd-kit pointer listeners bound to the grip only, so click vs drag
   *  don't fight each other. */
  dragListeners?: DraggableSyntheticListeners;
  /** Org tz so start times read in the org's wall clock. Optional
   *  because the DragOverlay preview stamps a plain card at drag
   *  time and we don't need to thread tz through its context. */
  tz?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "rounded-md border border-border bg-background p-2 text-xs shadow-sm",
        dragging && "shadow-lg ring-2 ring-primary",
        onClick &&
          "cursor-pointer transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone,
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="font-semibold">{booking.client_name}</div>
        {canDrag && dragListeners ? (
          <button
            type="button"
            aria-label="Drag to reschedule"
            onClick={(e) => e.stopPropagation()}
            {...dragListeners}
            className="shrink-0 rounded p-0.5 text-muted-foreground cursor-grab active:cursor-grabbing hover:bg-muted hover:text-foreground"
          >
            <GripVertical className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="tabular-nums text-muted-foreground">
        {formatHourMinute(booking.scheduled_at, tz)} · {booking.duration_minutes}m
      </div>
      <div className="mt-1 flex items-center gap-1">
        <StatusBadge tone={bookingStatusTone(booking.status)}>
          {humanizeEnum(booking.status)}
        </StatusBadge>
      </div>
    </div>
  );
}

function UnassignedTray({
  bookings,
  canEdit,
  isPending,
  onQuickView,
  tz,
}: {
  bookings: ScheduleBooking[];
  canEdit: boolean;
  isPending: boolean;
  onQuickView: (bookingId: string) => void;
  tz: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "unassigned",
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border-2 border-dashed border-amber-400/60 bg-amber-50/40 p-4 transition-colors dark:bg-amber-950/20",
        isOver && "border-amber-500 bg-amber-100/60 dark:bg-amber-900/30",
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Needs assignment ({bookings.length})
        </h2>
        {isPending ? (
          <span className="text-xs text-muted-foreground">Saving…</span>
        ) : null}
      </div>
      {bookings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Every booking this week has a cleaner. Drop a booking here to unassign it.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bookings.map((b) => (
            <DraggableBooking
              key={b.id}
              booking={b}
              canEdit={canEdit}
              onQuickView={onQuickView}
              tz={tz}
            />
          ))}
        </div>
      )}
    </div>
  );
}
