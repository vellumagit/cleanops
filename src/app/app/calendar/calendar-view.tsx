"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  ExternalLink,
} from "lucide-react";
import type { CalendarEvent } from "./page";

type ViewMode = "month" | "week" | "day";

type EventSource = "booking" | "invoice" | "google_calendar";

type Props = {
  events: CalendarEvent[];
  hasGoogleCalendar?: boolean;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CalendarView({ events, hasGoogleCalendar }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  // Restore Google Calendar toggle from localStorage at mount time so
  // we don't cascade-render from a setState-in-effect.
  const [enabledSources, setEnabledSources] = useState<Set<EventSource>>(
    () => {
      const defaults: EventSource[] = ["booking", "invoice", "google_calendar"];
      if (typeof window === "undefined") return new Set(defaults);
      try {
        const stored = localStorage.getItem("cleanops_gcal_overlay");
        if (stored === "false") {
          return new Set<EventSource>(
            defaults.filter((s) => s !== "google_calendar"),
          );
        }
      } catch {
        // localStorage blocked (private mode, iframe) — use defaults
      }
      return new Set(defaults);
    },
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
      // Persist Google Calendar toggle
      if (source === "google_calendar") {
        try {
          localStorage.setItem(
            "cleanops_gcal_overlay",
            next.has(source) ? "true" : "false",
          );
        } catch {
          // localStorage unavailable
        }
      }
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
            {hasGoogleCalendar && (
              <SourceToggle
                label="Google Cal"
                icon={<CalendarDays className="h-3 w-3" />}
                color="#8b5cf6"
                enabled={enabledSources.has("google_calendar")}
                onToggle={() => toggleSource("google_calendar")}
              />
            )}
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

      {/* Calendar grid + side detail panel */}
      <div className="flex gap-4">
        <div className={`rounded-lg border border-border bg-card overflow-hidden transition-all ${selectedEvent ? "flex-1 min-w-0" : "w-full"}`}>
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

        {/* Event detail side panel */}
        {selectedEvent && (
          <div className="w-72 shrink-0 self-start sticky top-4">
            <EventDetail
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          </div>
        )}
      </div>
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
                        {ev.type === "booking" || ev.type === "google_calendar"
                          ? format(new Date(ev.start), "h:mma")
                          : "Due"}{" "}
                        {ev.type === "google_calendar"
                          ? ev.title
                          : ev.meta && "client" in ev.meta
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
  // Full 24-hour day. Scroll container below caps the visual height so
  // owners can scroll to early mornings / late evenings instead of being
  // clipped to an arbitrary 6am–7pm window.
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const ROW_PX = 56; // matches h-14

  // Auto-scroll to the current hour on mount so "now" is visible
  // without manual scrolling. Uses a one-shot ref guard so re-renders
  // from event filtering don't keep yanking the scroll back.
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const nowHour = new Date().getHours();
    // Land two hours before "now" so the current block is near the top
    // but the morning stuff is still glanceable.
    const target = Math.max(0, (nowHour - 2) * ROW_PX);
    el.scrollTop = target;
    didInitialScroll.current = true;
  }, []);

  return (
    <div className="overflow-x-auto">
      {/* Header — outside the scroll container so it stays pinned visually. */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-card">
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

      {/* Time grid — scroll container so 24h doesn't explode the layout. */}
      <div
        ref={scrollRef}
        className="max-h-[72vh] overflow-y-auto"
      >
        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
          {hours.map((hour) => (
            <div key={hour} className="contents">
              {/* Time gutter — label straddles the TOP border of its own
                  cell, so visually it labels the hour LINE rather than
                  floating in the middle of the hour block. First row's
                  label is hidden (would bleed into the day header). */}
              <div className="relative border-r border-b border-border h-14">
                {hour > 0 && (
                  <span className="absolute right-1.5 top-0 -translate-y-1/2 rounded bg-card px-1 text-[10px] leading-none text-muted-foreground">
                    {formatHourLabel(hour)}
                  </span>
                )}
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
                        (evStart.getMinutes() / 60) * ROW_PX;
                      const height = Math.max(
                        (duration / 60) * ROW_PX,
                        20,
                      );

                      return (
                        <button
                          key={ev.id}
                          onClick={() => onSelectEvent(ev)}
                          className={`absolute left-0.5 right-0.5 z-10 overflow-hidden rounded px-1.5 py-0.5 text-left text-[10px] leading-tight text-white transition-opacity hover:opacity-80 ${
                            ev.type === "google_calendar"
                              ? "border border-dashed border-white/30 opacity-85"
                              : ""
                          }`}
                          style={{
                            top: `${topOffset}px`,
                            height: `${Math.min(height, ROW_PX * 4)}px`,
                            backgroundColor: ev.color,
                          }}
                          title={ev.title}
                        >
                          <span className="font-medium block truncate">
                            {format(new Date(ev.start), "h:mm")}
                          </span>
                          <span className="block truncate opacity-90">
                            {ev.type === "google_calendar"
                              ? ev.title
                              : ev.meta && "client" in ev.meta
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

  // Full 24-hour day. Clip the visual height with a scroll container
  // below so it doesn't push the rest of the page off-screen.
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const ROW_PX = 64; // matches h-16

  // Auto-scroll to the current hour when viewing today; otherwise
  // scroll to 6 AM as a sensible default for past/future days.
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const anchorHour = isToday(currentDate)
      ? Math.max(0, new Date().getHours() - 2)
      : 6;
    el.scrollTop = anchorHour * ROW_PX;
    didInitialScroll.current = true;
  }, [currentDate]);

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

      {/* Time slots — 24h in a scroll container. */}
      <div ref={scrollRef} className="max-h-[72vh] overflow-y-auto">
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
                {/* Time gutter — label straddles the top border line so
                    it labels the hour DIVIDER rather than floating
                    inside the block. First row skips the label to
                    avoid bleeding into the day header above. */}
                <div className="relative border-r border-b border-border h-16">
                  {hour > 0 && (
                    <span className="absolute right-1.5 top-0 -translate-y-1/2 rounded bg-card px-1 text-[10px] leading-none text-muted-foreground">
                      {formatHourLabel(hour)}
                    </span>
                  )}
                </div>
                <div className="relative border-b border-border h-16">
                  {cellEvents.map((ev) => {
                    const evStart = new Date(ev.start);
                    const evEnd = new Date(ev.end);
                    const duration = Math.max(
                      differenceInMinutes(evEnd, evStart),
                      30,
                    );
                    const topOffset =
                      (evStart.getMinutes() / 60) * ROW_PX;
                    const height = Math.max((duration / 60) * ROW_PX, 24);

                    return (
                      <button
                        key={ev.id}
                        onClick={() => onSelectEvent(ev)}
                        className={`absolute left-1 right-4 z-10 overflow-hidden rounded-md px-3 py-1.5 text-left text-xs text-white transition-opacity hover:opacity-80 ${
                          ev.type === "google_calendar"
                            ? "border border-dashed border-white/30 opacity-85"
                            : ""
                        }`}
                        style={{
                          top: `${topOffset}px`,
                          height: `${Math.min(height, ROW_PX * 3)}px`,
                          backgroundColor: ev.color,
                        }}
                      >
                        <span className="font-semibold">
                          {format(evStart, "h:mm a")}
                          {(ev.type === "booking" ||
                            ev.type === "google_calendar") &&
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
    </div>
  );
}

/**
 * Hour-label formatter shared by Week and Day views.
 * 0 → "12 AM", 1–11 → "1 AM"…"11 AM", 12 → "12 PM",
 * 13–23 → "1 PM"…"11 PM".
 */
function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
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

        {event.type === "google_calendar" && (
          <>
            {event.meta.location && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{event.meta.location}</span>
              </div>
            )}
            {event.meta.description && (
              <p className="text-muted-foreground text-[11px] mt-1 line-clamp-4">
                {event.meta.description}
              </p>
            )}
            {event.meta.htmlLink && (
              <a
                href={event.meta.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-500 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Google Calendar
              </a>
            )}
          </>
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
