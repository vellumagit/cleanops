"use client";

import { useState } from "react";
import { Clock, User, ChevronDown, ChevronRight } from "lucide-react";
import { formatDateTime, formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimesheetRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_minutes: number;
  client_name: string | null;
  service_type: string | null;
  notes: string | null;
  is_open: boolean;
};

type EmpSummary = {
  id: string;
  name: string;
  totalMinutes: number;
  shiftCount: number;
  openShift: boolean;
};

export function TimesheetsTable({
  rows,
  summaries,
}: {
  rows: TimesheetRow[];
  summaries: EmpSummary[];
}) {
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "all">("summary");

  if (summaries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
        No time entries in the last 30 days.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          type="button"
          onClick={() => setView("summary")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "summary"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          By employee
        </button>
        <button
          type="button"
          onClick={() => setView("all")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "all"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          All entries
        </button>
      </div>

      {view === "summary" ? (
        <div className="space-y-2">
          {summaries.map((emp) => {
            const isExpanded = expandedEmp === emp.id;
            const empRows = rows.filter((r) => r.employee_id === emp.id);
            const hours = Math.floor(emp.totalMinutes / 60);
            const mins = emp.totalMinutes % 60;

            return (
              <div key={emp.id} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Summary row */}
                <button
                  type="button"
                  onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{emp.name}</span>
                      {emp.openShift && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Clocked in
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {emp.shiftCount} shift{emp.shiftCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {hours}h {mins > 0 ? `${mins}m` : ""}
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                          <th className="px-4 py-2 text-left font-medium">Clock in</th>
                          <th className="px-4 py-2 text-left font-medium">Clock out</th>
                          <th className="px-4 py-2 text-left font-medium">Duration</th>
                          <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Client</th>
                          <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Service</th>
                        </tr>
                      </thead>
                      <tbody>
                        {empRows.map((r) => (
                          <tr key={r.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2.5 tabular-nums">
                              {formatDateTime(r.clock_in_at)}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">
                              {r.is_open ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                  In progress
                                </span>
                              ) : (
                                formatDateTime(r.clock_out_at)
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-medium tabular-nums">
                              {r.is_open ? "—" : formatDurationMinutes(r.duration_minutes)}
                            </td>
                            <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">
                              {r.client_name ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">
                              {r.service_type ? humanizeEnum(r.service_type) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* All entries flat table */
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                  <th className="px-4 py-2.5 text-left font-medium">Clock in</th>
                  <th className="px-4 py-2.5 text-left font-medium">Clock out</th>
                  <th className="px-4 py-2.5 text-left font-medium">Duration</th>
                  <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Client</th>
                  <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">Service</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-medium">{r.employee_name}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatDateTime(r.clock_in_at)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {r.is_open ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          In progress
                        </span>
                      ) : (
                        formatDateTime(r.clock_out_at)
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium tabular-nums">
                      {r.is_open ? "—" : formatDurationMinutes(r.duration_minutes)}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">
                      {r.client_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">
                      {r.service_type ? humanizeEnum(r.service_type) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
