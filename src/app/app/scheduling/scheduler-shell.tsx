"use client";

import { useEffect, useMemo, useState } from "react";
import { WeekGrid } from "./week-grid";
import { DispatchGrid } from "./dispatch-grid";
import {
  SchedulerFilters,
  DEFAULT_FILTERS,
  type SchedulerFilters as SchedulerFiltersState,
} from "./scheduler-filters";
import type { ScheduleBooking, ScheduleEmployee } from "./data";

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
}: {
  view: "week" | "day";
  weekStart: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  offDays: Record<string, string[]>;
  canEdit: boolean;
  tz: string;
}) {
  const [filters, setFilters] =
    useState<SchedulerFiltersState>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

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
      <div className="flex items-center justify-end">
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
