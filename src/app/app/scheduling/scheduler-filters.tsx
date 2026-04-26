"use client";

import { useMemo } from "react";
import { Filter, Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee } from "./data";

/**
 * Client-side filter state for the scheduler.
 *
 * Kept in a single shape so both Week and Dispatch can consume it
 * identically and the Filters component can be re-used verbatim.
 * Stored in localStorage by the parent page so refreshing the
 * scheduler doesn't lose an owner's preferences.
 */
export type SchedulerFilters = {
  /** IDs of employees to SHOW. Empty array = show all. */
  visibleEmployees: string[];
  /** Hide cancelled bookings? */
  hideCancelled: boolean;
  /** What drives the lane / card color: employee (default), service
   *  type, client, or status. */
  colorBy: "employee" | "service" | "client" | "status";
};

export const DEFAULT_FILTERS: SchedulerFilters = {
  visibleEmployees: [],
  hideCancelled: false,
  colorBy: "employee",
};

const COLOR_OPTIONS: Array<{
  value: SchedulerFilters["colorBy"];
  label: string;
}> = [
  { value: "employee", label: "Employee" },
  { value: "service", label: "Service type" },
  { value: "client", label: "Client" },
  { value: "status", label: "Status" },
];

/**
 * Filter pill + popover. The popover shows employee checkboxes, a
 * "hide cancelled" toggle, and a color-by radio group. All changes
 * stream back via onChange — parent owns persistence.
 */
export function SchedulerFilters({
  employees,
  filters,
  onChange,
  open,
  onOpenChange,
}: {
  employees: ScheduleEmployee[];
  filters: SchedulerFilters;
  onChange: (next: SchedulerFilters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const showingAll =
    filters.visibleEmployees.length === 0 ||
    filters.visibleEmployees.length === employees.length;

  const activeCount = useMemo(() => {
    let n = 0;
    if (!showingAll) n += 1;
    if (filters.hideCancelled) n += 1;
    if (filters.colorBy !== "employee") n += 1;
    return n;
  }, [showingAll, filters.hideCancelled, filters.colorBy]);

  function toggleEmployee(id: string) {
    const current = new Set(
      filters.visibleEmployees.length === 0
        ? employees.map((e) => e.id)
        : filters.visibleEmployees,
    );
    if (current.has(id)) current.delete(id);
    else current.add(id);
    // If they untoggled everything, fall back to "show all" (empty
    // array) rather than a blank calendar.
    const arr = current.size === 0 ? [] : Array.from(current);
    // Normalize "show all" to empty array for clean URLs / storage.
    onChange({
      ...filters,
      visibleEmployees:
        arr.length === employees.length ? [] : arr,
    });
  }

  function selectAll() {
    onChange({ ...filters, visibleEmployees: [] });
  }

  function selectNone() {
    onChange({
      ...filters,
      // Single invisible "placeholder" prevents show-all fallback
      // when the user really does want nothing showing.
      visibleEmployees: ["__none__"],
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
          activeCount > 0 && "border-foreground/40",
        )}
      >
        <Filter className="h-3.5 w-3.5" />
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-outside overlay — no portal needed for this size */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-4 shadow-lg">
            {/* Employee list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Show employees
                </p>
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    All
                  </button>
                  <span className="text-muted-foreground/40">·</span>
                  <button
                    type="button"
                    onClick={selectNone}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    None
                  </button>
                </div>
              </div>
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {employees.map((emp) => {
                  const selected =
                    filters.visibleEmployees.length === 0
                      ? true
                      : filters.visibleEmployees.includes(emp.id);
                  return (
                    <li key={emp.id}>
                      <button
                        type="button"
                        onClick={() => toggleEmployee(emp.id)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-transparent",
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span
                          className={cn(
                            "truncate",
                            !selected && "text-muted-foreground",
                          )}
                        >
                          {emp.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Hide cancelled toggle */}
            <div className="mt-4 border-t border-border pt-3">
              <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted">
                <span className="flex items-center gap-2 text-xs">
                  {filters.hideCancelled ? (
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  Hide cancelled bookings
                </span>
                <input
                  type="checkbox"
                  checked={filters.hideCancelled}
                  onChange={(e) =>
                    onChange({ ...filters, hideCancelled: e.target.checked })
                  }
                  className="h-4 w-4"
                />
              </label>
            </div>

            {/* Color-by radio */}
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Color cards by
              </p>
              <div className="grid grid-cols-2 gap-1">
                {COLOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      onChange({ ...filters, colorBy: opt.value })
                    }
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs transition-colors",
                      filters.colorBy === opt.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Hash a string to an index — used to consistently color the same
 * service type / client / status across the grid regardless of
 * order in the data.
 */
export function colorIndexFor(key: string, range: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h << 5) - h + key.charCodeAt(i);
    h |= 0; // 32-bit
  }
  return Math.abs(h) % range;
}
