"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WeekGrid } from "./week-grid";
import { DispatchGrid } from "./dispatch-grid";
import {
  SchedulerFilters,
  DEFAULT_FILTERS,
  type SchedulerFilters as SchedulerFiltersState,
} from "./scheduler-filters";
import { SavedViews } from "./saved-views";
import type {
  ScheduleBooking,
  ScheduleEmployee,
  SchedulerView,
} from "./data";

const STORAGE_KEY = "cleanops.scheduler.filters";

/**
 * Client wrapper that owns the filter state + persists it to
 * localStorage, then filters the bookings / employees arrays before
 * delegating to the appropriate grid. Both grids are client
 * components that previously had no filter concept — threading one
 * shared shell keeps them lean.
 *
 * Server page is still responsible for: date navigation, data fetch,
 * tz + org metadata. This component is purely the "which subset of
 * what the server gave us do we show" layer.
 */
export function SchedulerShell({
  view,
  weekStart,
  bookings,
  employees,
  offDays,
  canEdit,
  tz,
  savedViews,
}: {
  view: "week" | "day";
  weekStart: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  offDays: Record<string, string[]>;
  canEdit: boolean;
  tz: string;
  savedViews: SchedulerView[];
}) {
  const [filters, setFilters] =
    useState<SchedulerFiltersState>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const router = useRouter();

  // Rehydrate from localStorage on mount. We start with DEFAULT_FILTERS
  // during SSR and the first client render to avoid hydration drift,
  // then swap to whatever was saved.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SchedulerFiltersState>;
        setFilters({ ...DEFAULT_FILTERS, ...parsed });
      }
    } catch {
      // localStorage blocked (private mode, iframe) — stick with defaults
    }
  }, []);

  // Persist on change — debouncing isn't worth it at this cadence.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters]);

  // Keyboard shortcuts. Matches the pattern from Gmail / Linear so
  // power users can drive the scheduler without touching the mouse.
  // Skipped when any text input is focused — you don't want typing a
  // filter name to jump the view.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const tag = (e.target as HTMLElement | null)?.tagName;
      const isEditing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (isEditing) return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;

      const step = view === "day" ? 1 : 7;
      const nav = (target: string) => {
        router.push(
          `/app/scheduling?view=${view}&week=${target}`,
        );
      };

      switch (e.key) {
        case "ArrowLeft":
          nav(shiftDate(weekStart, -step));
          e.preventDefault();
          break;
        case "ArrowRight":
          nav(shiftDate(weekStart, step));
          e.preventDefault();
          break;
        case "t":
        case "T": {
          const today = new Date();
          // For week view, snap back to Monday of this week; for day
          // view, land exactly on today.
          const target =
            view === "day"
              ? formatYMD(today)
              : formatYMD(getMondayOf(today));
          nav(target);
          e.preventDefault();
          break;
        }
        case "d":
        case "D":
          router.push(`/app/scheduling?view=day&week=${weekStart}`);
          e.preventDefault();
          break;
        case "w":
        case "W":
          router.push(
            `/app/scheduling?view=week&week=${formatYMD(getMondayOf(parseYMD(weekStart)))}`,
          );
          e.preventDefault();
          break;
        case "n":
        case "N":
          router.push("/app/bookings/new");
          e.preventDefault();
          break;
        case "/":
          setFilterOpen(true);
          e.preventDefault();
          break;
        case "?":
          // Show a quick help — keep it lightweight, no modal. A
          // toast-style list suffices; users quickly learn the ones
          // they need.
          if (typeof window !== "undefined") {
            // eslint-disable-next-line no-alert
            alert(
              "Scheduler shortcuts\n\n" +
                "←/→  prev/next\n" +
                "t    today\n" +
                "d    day view\n" +
                "w    week view\n" +
                "n    new booking\n" +
                "/    open filters\n" +
                "?    this help",
            );
          }
          e.preventDefault();
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, weekStart, router]);

  const visibleEmployeeSet = useMemo(() => {
    // Empty array = show all. Single "__none__" placeholder = show none.
    if (filters.visibleEmployees.length === 0) {
      return new Set(employees.map((e) => e.id));
    }
    return new Set(filters.visibleEmployees);
  }, [filters.visibleEmployees, employees]);

  const filteredEmployees = useMemo(
    () => employees.filter((e) => visibleEmployeeSet.has(e.id)),
    [employees, visibleEmployeeSet],
  );

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      if (filters.hideCancelled && b.status === "cancelled") return false;
      // Unassigned bookings are shown regardless of the employee
      // filter — otherwise they disappear from the unassigned tray.
      if (!b.assigned_to) return true;
      return visibleEmployeeSet.has(b.assigned_to);
    });
  }, [bookings, filters.hideCancelled, visibleEmployeeSet]);

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <SavedViews
          views={savedViews.map((v) => ({
            id: v.id,
            name: v.name,
            filters: v.filters,
            sort_order: v.sort_order,
          }))}
          currentFilters={filters}
          canEdit={canEdit}
          onApply={setFilters}
        />
        <SchedulerFilters
          employees={employees}
          filters={filters}
          onChange={setFilters}
          open={filterOpen}
          onOpenChange={setFilterOpen}
        />
      </div>

      {view === "day" ? (
        <DispatchGrid
          date={weekStart}
          bookings={filteredBookings}
          employees={filteredEmployees}
          canEdit={canEdit}
          tz={tz}
          offDays={offDays}
        />
      ) : (
        <WeekGrid
          weekStart={weekStart}
          bookings={filteredBookings}
          employees={filteredEmployees}
          canEdit={canEdit}
          view={view}
          tz={tz}
          offDays={offDays}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Small date helpers — kept local to avoid cluttering scheduling/data.ts
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

function shiftDate(ymd: string, days: number): string {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}

function getMondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = out.getDay(); // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + offset);
  return out;
}
