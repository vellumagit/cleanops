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
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";

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
  currency = "CAD",
}: {
  view: "week" | "day";
  weekStart: string;
  bookings: ScheduleBooking[];
  employees: ScheduleEmployee[];
  offDays: Record<string, string[]>;
  canEdit: boolean;
  tz: string;
  savedViews: SchedulerView[];
  currency?: CurrencyCode;
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

  // Revenue summary for the current filtered view. Only count
  // bookings that have a total_cents value set; cancelled bookings
  // are always excluded from revenue so owners see "real" numbers.
  const revenue = useMemo(() => {
    let scheduled = 0;
    let completed = 0;
    let jobsWithRevenue = 0;
    for (const b of filteredBookings) {
      if (b.status === "cancelled") continue;
      if (b.total_cents == null) continue;
      jobsWithRevenue++;
      scheduled += b.total_cents;
      if (b.status === "completed") completed += b.total_cents;
    }
    return { scheduled, completed, remaining: scheduled - completed, jobsWithRevenue };
  }, [filteredBookings]);

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

      {/* Revenue summary bar — only rendered when at least one booking
          in the current view has a total_cents value, so orgs that
          haven't set booking amounts don't see an empty $0 bar. */}
      {revenue.jobsWithRevenue > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Revenue
          </span>
          <div className="flex flex-wrap gap-4 ml-1">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Scheduled</span>
              <span className="font-semibold tabular-nums">
                {formatCurrencyCents(revenue.scheduled, currency)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground text-xs">Earned</span>
              <span className="font-semibold tabular-nums text-emerald-600">
                {formatCurrencyCents(revenue.completed, currency)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="text-muted-foreground text-xs">Remaining</span>
              <span className="font-semibold tabular-nums text-amber-600">
                {formatCurrencyCents(revenue.remaining, currency)}
              </span>
            </div>
          </div>
        </div>
      )}

      {view === "day" ? (
        <DispatchGrid
          date={weekStart}
          bookings={filteredBookings}
          employees={filteredEmployees}
          canEdit={canEdit}
          tz={tz}
          offDays={offDays}
          colorBy={filters.colorBy}
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
          colorBy={filters.colorBy}
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
