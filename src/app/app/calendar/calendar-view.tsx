"use client";

import { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  isSameMonth,
  isSameDay,
  isToday,
  startOfDay,
  endOfDay,
  differenceInMinutes,
  setHours,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarDays,
  CalendarRange,
  MapPin,
  User,
  Receipt,
  Clock,
} from "lucide-react";
import type { CalendarEvent } from "./page";

type ViewMode = "month" | "week" | "day";

type EventSource = "booking" | "invoice";

type Props = {
  events: CalendarEvent[];
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CalendarView({ events }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [enabledSources, setEnabledSources] = useState<Set<EventSource>>(
    new Set(["booking", "invoice"]),
  );

  const filteredEvents = useMemo(
    () => events.filter((e) => enabledSources.has(e.type)),
    [events, enabledSources],
  );

  function toggleSource(source: EventSource) {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  function navigate(direction: "prev" | "next" | "today") {
    if (direction === "today") {
      setCurrentDate(new Date());
      return;
    }
    const d = direction === "next" ? 1 : -1;
    if (view === "month") setCurrentDate((c) => addMonths(c, d));
    else if (view === "week") setCurrentDate((c) => addWeeks(c, d));
    else setCurrentDate((c) => addDays(c, d));
  }

  function getTitle(): string {
    if (view === "month") return format(currentDate, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
      const we = endOfWeek(currentDate, { weekStartsOn: 0 });
      if (ws.getMonth() === we.getMonth()) {
        return `${format(ws, "MMM d")} – ${format(we, "d, yyyy")}`;
      }
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(currentDate, "EEEE, MMMM d, yyyy");
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("prev")}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate("today")}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => navigate("next")}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 text-sm font-semibold text-foreground">
            {getTitle()}
          </h2>
        </div>

        {/* View switcher + source toggles */}
        <div className="flex items-center gap-3">
          {/* Source toggles */}
          <div className="flex items-center gap-1.5">
            <SourceToggle
              label="Bookings"
              icon={<CalendarIcon className="h-3 w-3" />}
              color="#3b82f6"
              enabled={enabledSources.has("booking")}
              onToggle={() => toggleSource("booking")}
            />
            <SourceToggle
              label="Invoices"
              icon={<Receipt className="h-3 w-3" />}
              color="#f59e0b"
              enabled={enabledSources.has("invoice")}
              onToggle={() => toggleSource("invoice")}
            />
          </div>

          <div className="h-4 w-px bg-border" />

          {/* View mode */}
          <div className="flex rounded-md border border-border bg-card">
            <ViewButton
              active={view === "month"}
              onClick={() => setView("month")}
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Month"
            />
            <ViewButton
              active={view === "week"}
              onClick={() => setView("week")}
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              label="Week"
            />
            <ViewButton
              active={view === "day"}
              onClick={() => setView("day")}
              icon={<CalendarIcon className="h-3.5 w-3.5" />}
              label="Day"
            />
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {view === "month" && (
          <MonthView
            currentDate={currentDate}
            events={filteredEvents}
            onSelectEvent={setSelectedEvent}
            onDayClick={(d) => {
              setCurrentDate(d);
              setView("day");
            }}
          />
        )}
        {view === "week" && (
          <WeekView
            currentDate={currentDate}
            events={filteredEvents}
            onSelectEvent={setSelectedEvent}
          />
        )}
        {view === "day" && (
          <DayView
            currentDate={currentDate}
            events={filteredEvents}
            onSelectEvent={setSelectedEvent}
          />
        )}
      </div>

      {/* Event detail panel */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SourceToggle({
  label,
  icon,
  color,
  enabled,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        enabled
          ? "border-border bg-card text-foreground"
          : "border-transparent bg-transparent text-muted-foreground/50 line-through"
      }`}
    >
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: enabled ? color : "#a1a1aa" }}
      />
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Month View
// ---------------------------------------------------------------------------

function MonthView({
  currentDate,
  events,
  onSelectEvent,
  onDayClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
  onDayClick: (d: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const weeks: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {DAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div
          key={wi}
          className="grid grid-cols-7 border-b border-border last:border-b-0"
        >
          {week.map((d) => {
            const dayEvents = events.filter((e) =>
              isSameDay(new Date(e.start), d),
            );
            const inMonth = isSameMonth(d, currentDate);
            const today = isToday(d);

            return (
              <div
                key={d.toISOString()}
                className={`min-h-[100px] border-r border-border last:border-r-0 p-1.5 cursor-pointer transition-colors hover:bg-muted/30 ${
                  !inMonth ? "bg-muted/10" : ""
                }`}
                onClick={() => onDayClick(d)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-xs font-medium ${
                      today
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {format(d, "d")}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <button
                      key={ev.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(ev);
                      }}
                      className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] leading-tight transition-colors hover:bg-muted"
                      title={ev.title}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: ev.color }}
                      />
                      <span className="truncate text-foreground">
                        {ev.type === "booking"
                          ? format(new Date(ev.start), "h:mma")
                          : "Due"}{" "}
                        {ev.meta && "client" in ev.meta
                          ? ev.meta.client
                          : ""}
                      </span>
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="block px-1 text-[10px] text-muted-foreground">
                      +{dayEvents.length - 3} more
                    </span>
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

// ---------------------------------------------------------------------------
// Week View
// ---------------------------------------------------------------------------

function WeekView({
  currentDate,
  events,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 14 }, (_, i) => i + 6); // 6am–7pm

  return (
    <div className="overflow-x-auto">
      {/* Header */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border sticky top-0 bg-card z-10">
        <div className="border-r border-border" />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className={`border-r border-border last:border-r-0 px-2 py-2 text-center ${
              isToday(d) ? "bg-foreground/5" : ""
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {format(d, "EEE")}
            </span>
            <span
              className={`ml-1 text-sm font-semibold ${
                isToday(d)
                  ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background"
                  : "text-foreground"
              }`}
            >
              {format(d, "d")}
            </span>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)]">
        {hours.map((hour) => (
          <div key={hour} className="contents">
            {/* Time label */}
            <div className="border-r border-b border-border px-2 py-0 h-14 flex items-start justify-end">
              <span className="text-[10px] text-muted-foreground -mt-1.5">
                {hour === 0
                  ? "12 AM"
                  : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                      ? "12 PM"
                      : `${hour - 12} PM`}
              </span>
            </div>
            {/* Day columns */}
            {days.map((d) => {
              const cellStart = setHours(startOfDay(d), hour);
              const cellEnd = setHours(startOfDay(d), hour + 1);
              const cellEvents = events.filter((e) => {
                const eStart = new Date(e.start);
                return (
                  isSameDay(eStart, d) &&
                  eStart >= cellStart &&
                  eStart < cellEnd
                );
              });

              return (
                <div
                  key={`${d.toISOString()}-${hour}`}
                  className={`relative border-r border-b border-border last:border-r-0 h-14 ${
                    isToday(d) ? "bg-foreground/[0.02]" : ""
                  }`}
                >
                  {cellEvents.map((ev) => {
                    const evStart = new Date(ev.start);
                    const evEnd = new Date(ev.end);
                    const duration = Math.max(
                      differenceInMinutes(evEnd, evStart),
                      30,
                    );
                    const topOffset =
                      ((evStart.getMinutes()) / 60) * 56; // 56px = h-14
                    const height = Math.max(
                      (duration / 60) * 56,
                      20,
                    );

                    return (
                      <button
                        key={ev.id}
                        onClick={() => onSelectEvent(ev)}
                        className="absolute left-0.5 right-0.5 z-10 overflow-hidden rounded px-1.5 py-0.5 text-left text-[10px] leading-tight text-white transition-opacity hover:opacity-80"
                        style={{
                          top: `${topOffset}px`,
                          height: `${Math.min(height, 112)}px`,
                          backgroundColor: ev.color,
                        }}
                        title={ev.title}
                      >
                        <span className="font-medium block truncate">
                          {format(new Date(ev.start), "h:mm")}
                        </span>
                        <span className="block truncate opacity-90">
                          {ev.meta && "client" in ev.meta
                            ? ev.meta.client
                            : ev.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day View
// ---------------------------------------------------------------------------

function DayView({
  currentDate,
  events,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const dayStart = startOfDay(currentDate);
  const dayEnd = endOfDay(currentDate);
  const dayEvents = events.filter((e) => {
    const eStart = new Date(e.start);
    return eStart >= dayStart && eStart <= dayEnd;
  });

  const hours = Array.from({ length: 16 }, (_, i) => i + 5); // 5am–8pm

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`text-lg font-semibold ${
              isToday(currentDate)
                ? "flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background"
                : "text-foreground"
            }`}
          >
            {format(currentDate, "d")}
          </span>
          <div>
            <span className="text-sm font-medium text-foreground">
              {format(currentDate, "EEEE")}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">
              {format(currentDate, "MMMM yyyy")}
            </span>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Time slots */}
      <div className="grid grid-cols-[60px_1fr]">
        {hours.map((hour) => {
          const cellStart = setHours(dayStart, hour);
          const cellEnd = setHours(dayStart, hour + 1);
          const cellEvents = dayEvents.filter((e) => {
            const eStart = new Date(e.start);
            return eStart >= cellStart && eStart < cellEnd;
          });

          return (
            <div key={hour} className="contents">
              <div className="border-r border-b border-border px-2 h-16 flex items-start justify-end">
                <span className="text-[10px] text-muted-foreground -mt-1.5">
                  {hour === 0
                    ? "12 AM"
                    : hour < 12
                      ? `${hour} AM`
                      : hour === 12
                        ? "12 PM"
                        : `${hour - 12} PM`}
                </span>
              </div>
              <div className="relative border-b border-border h-16">
                {cellEvents.map((ev) => {
                  const evStart = new Date(ev.start);
                  const evEnd = new Date(ev.end);
                  const duration = Math.max(
                    differenceInMinutes(evEnd, evStart),
                    30,
                  );
                  const topOffset = (evStart.getMinutes() / 60) * 64;
                  const height = Math.max((duration / 60) * 64, 24);

                  return (
                    <button
                      key={ev.id}
                      onClick={() => onSelectEvent(ev)}
                      className="absolute left-1 right-4 z-10 overflow-hidden rounded-md px-3 py-1.5 text-left text-xs text-white transition-opacity hover:opacity-80"
                      style={{
                        top: `${topOffset}px`,
                        height: `${Math.min(height, 192)}px`,
                        backgroundColor: ev.color,
                      }}
                    >
                      <span className="font-semibold">
                        {format(evStart, "h:mm a")}
                        {ev.type === "booking" &&
                          ` – ${format(evEnd, "h:mm a")}`}
                      </span>
                      <span className="ml-2 opacity-90">{ev.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Detail Panel
// ---------------------------------------------------------------------------

function EventDetail({
  event,
  onClose,
}: {
  event: CalendarEvent;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: event.color }}
          />
          <h3 className="text-sm font-semibold text-foreground">
            {event.title}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>

      <div className="mt-3 grid gap-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {format(new Date(event.start), "EEEE, MMMM d · h:mm a")}
            {event.type === "booking" &&
              event.start !== event.end &&
              ` – ${format(new Date(event.end), "h:mm a")}`}
          </span>
        </div>

        {event.type === "booking" && (
          <>
            <div className="flex items-center gap-2 text-muted-foreground">
              <User className="h-3.5 w-3.5 shrink-0" />
              <span>
                {event.meta.employee ?? "Unassigned"} → {event.meta.client}
              </span>
            </div>
            {event.meta.address && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{event.meta.address}</span>
              </div>
            )}
          </>
        )}

        {event.type === "invoice" && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Receipt className="h-3.5 w-3.5 shrink-0" />
            <span>
              {event.meta.number ?? "Invoice"} — {event.meta.client} —{" "}
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(event.meta.amount / 100)}
            </span>
          </div>
        )}

        <div className="mt-1">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: event.color }}
          >
            {event.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>
    </div>
  );
}
