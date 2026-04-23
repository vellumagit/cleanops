"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  ChevronDown,
  ChevronRight,
  Download,
  CalendarRange,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Timer,
  Palmtree,
  Plus,
  Pencil,
} from "lucide-react";
import {
  formatDateTime,
  formatDurationMinutes,
  formatCurrencyCents,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  TimesheetEntry,
  EmployeeMeta,
  PtoEntry,
  BookingOption,
} from "./types";
import { PtoApprovalPanel } from "./pto-approval-panel";
import {
  ManualEntryDialog,
  type EditingEntry,
} from "./manual-entry-dialog";

type EmpSummary = {
  id: string;
  name: string;
  totalMinutes: number;
  shiftCount: number;
  openShift: boolean;
  earnedCents: number;
  payRateCents: number;
  payType: string;
  lateCount: number;
  earlyCount: number;
  overCount: number;
  underCount: number;
  ptoHours: number;
};

function buildSummaries(
  entries: TimesheetEntry[],
  employees: Record<string, EmployeeMeta>,
  ptoEntries: PtoEntry[],
): EmpSummary[] {
  const map = new Map<string, EmpSummary>();

  for (const e of entries) {
    const existing = map.get(e.employee_id) ?? {
      id: e.employee_id,
      name: e.employee_name,
      totalMinutes: 0,
      shiftCount: 0,
      openShift: false,
      earnedCents: 0,
      payRateCents: employees[e.employee_id]?.pay_rate_cents ?? 0,
      payType: employees[e.employee_id]?.pay_type ?? "hourly",
      lateCount: 0,
      earlyCount: 0,
      overCount: 0,
      underCount: 0,
      ptoHours: 0,
    };
    existing.totalMinutes += e.actual_minutes;
    existing.shiftCount += 1;
    existing.earnedCents += e.earned_cents;
    if (e.is_open) existing.openShift = true;
    if (e.punctuality === "late") existing.lateCount += 1;
    if (e.punctuality === "early") existing.earlyCount += 1;
    if (e.completion === "over") existing.overCount += 1;
    if (e.completion === "under") existing.underCount += 1;
    map.set(e.employee_id, existing);
  }

  // Add PTO hours
  for (const p of ptoEntries) {
    if (p.status !== "approved") continue;
    const existing = map.get(p.employee_id);
    if (existing) {
      existing.ptoHours += p.hours;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function PunctualityBadge({
  type,
  minutes,
}: {
  type: "early" | "on_time" | "late" | null;
  minutes: number;
}) {
  if (!type) return null;
  if (type === "on_time")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> On time
      </span>
    );
  if (type === "early")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
        <TrendingUp className="h-3 w-3" /> {minutes}m early
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
      <AlertTriangle className="h-3 w-3" /> {minutes}m late
    </span>
  );
}

function CompletionBadge({
  type,
  minutes,
}: {
  type: "under" | "on_target" | "over" | null;
  minutes: number;
}) {
  if (!type) return null;
  if (type === "on_target")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <Timer className="h-3 w-3" /> On target
      </span>
    );
  if (type === "under")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
        <TrendingUp className="h-3 w-3" /> {formatDurationMinutes(minutes)} faster
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      <Timer className="h-3 w-3" /> {formatDurationMinutes(minutes)} over
    </span>
  );
}

function generateCSV(entries: TimesheetEntry[]): string {
  const header = [
    "Employee",
    "Clock In",
    "Clock Out",
    "Actual Duration",
    "Client",
    "Service",
    "Scheduled At",
    "Estimated Duration",
    "Arrival",
    "Completion",
    "Pay Rate",
    "Pay Type",
    "Earned",
  ].join(",");

  const rows = entries.map((e) =>
    [
      `"${e.employee_name}"`,
      `"${e.clock_in_at}"`,
      `"${e.clock_out_at ?? ""}"`,
      e.actual_minutes,
      `"${e.client_name ?? ""}"`,
      `"${e.service_type ?? ""}"`,
      `"${e.scheduled_at ?? ""}"`,
      e.estimated_minutes ?? "",
      `"${e.punctuality ?? ""}"`,
      `"${e.completion ?? ""}"`,
      (e.pay_rate_cents / 100).toFixed(2),
      e.pay_type,
      (e.earned_cents / 100).toFixed(2),
    ].join(","),
  );

  return [header, ...rows].join("\n");
}

export function TimesheetsView({
  entries,
  employees,
  ptoEntries,
  bookings,
  orgTz,
  from,
  to,
}: {
  entries: TimesheetEntry[];
  employees: Record<string, EmployeeMeta>;
  ptoEntries: PtoEntry[];
  bookings: BookingOption[];
  orgTz: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [view, setView] = useState<"summary" | "all">("summary");
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  // Manual-entry dialog state. "create" = fresh entry, "edit" = prefilled
  // for correcting an existing row.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingEntry, setEditingEntry] = useState<EditingEntry | null>(null);

  const employeeList = Object.values(employees);

  function openCreate() {
    setDialogMode("create");
    setEditingEntry(null);
    setDialogOpen(true);
  }

  function openEdit(entry: TimesheetEntry) {
    setDialogMode("edit");
    setEditingEntry({
      id: entry.id,
      employee_id: entry.employee_id,
      booking_id: entry.booking_id,
      clock_in_at: entry.clock_in_at,
      clock_out_at: entry.clock_out_at,
      notes: entry.notes,
    });
    setDialogOpen(true);
  }

  const summaries = buildSummaries(entries, employees, ptoEntries);

  const totalHours = Math.round(
    entries.reduce((sum, e) => sum + e.actual_minutes, 0) / 60,
  );
  const totalEarned = entries.reduce((sum, e) => sum + e.earned_cents, 0);
  const totalPtoHours = ptoEntries
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + p.hours, 0);

  function applyDateRange() {
    router.push(`/app/timesheets?from=${localFrom}&to=${localTo}`);
  }

  function setPreset(days: number) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    setLocalFrom(start.toISOString().slice(0, 10));
    setLocalTo(end.toISOString().slice(0, 10));
    router.push(
      `/app/timesheets?from=${start.toISOString().slice(0, 10)}&to=${end.toISOString().slice(0, 10)}`,
    );
  }

  function downloadReport() {
    const csv = generateCSV(entries);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* ─── Date range picker ─────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <input
              type="date"
              value={localFrom}
              onChange={(e) => setLocalFrom(e.target.value)}
              className="block h-8 rounded-lg border border-input bg-transparent px-2.5 text-base"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input
              type="date"
              value={localTo}
              onChange={(e) => setLocalTo(e.target.value)}
              className="block h-8 rounded-lg border border-input bg-transparent px-2.5 text-base"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={applyDateRange}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Apply
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {[
            { label: "7d", days: 7 },
            { label: "14d", days: 14 },
            { label: "30d", days: 30 },
            { label: "90d", days: 90 },
          ].map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPreset(p.days)}
              className="h-8 rounded-lg border border-input px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Log hours
          </button>
          <button
            type="button"
            onClick={downloadReport}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* ─── Summary cards ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Total hours</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{totalHours}h</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Total earnings</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {formatCurrencyCents(totalEarned)}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Shifts</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{entries.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">PTO hours</div>
          <div className="mt-1 text-xl font-semibold tabular-nums flex items-center gap-1.5">
            <Palmtree className="h-4 w-4 text-amber-500" />
            {totalPtoHours}h
          </div>
        </div>
      </div>

      {/* ─── PTO approval panel (pending requests) ─────────── */}
      <PtoApprovalPanel requests={ptoEntries} />

      {/* ─── View toggle ───────────────────────────────────── */}
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

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
          <p>No time entries in this period.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Log hours manually
          </button>
        </div>
      ) : view === "summary" ? (
        <div className="space-y-2">
          {summaries.map((emp) => {
            const isExpanded = expandedEmp === emp.id;
            const empEntries = entries.filter(
              (e) => e.employee_id === emp.id,
            );
            const hours = Math.floor(emp.totalMinutes / 60);
            const mins = emp.totalMinutes % 60;
            const empPto = ptoEntries.filter(
              (p) => p.employee_id === emp.id && p.status === "approved",
            );

            return (
              <div
                key={emp.id}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedEmp(isExpanded ? null : emp.id)
                  }
                  className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {emp.name}
                      </span>
                      {emp.openShift && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Clocked in
                        </span>
                      )}
                      {emp.lateCount > 0 && (
                        <span className="text-[10px] text-red-500 font-medium">
                          {emp.lateCount} late
                        </span>
                      )}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>
                        {emp.shiftCount} shift{emp.shiftCount !== 1 ? "s" : ""}
                      </span>
                      <span>{formatCurrencyCents(emp.earnedCents)}</span>
                      {emp.ptoHours > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {emp.ptoHours}h PTO
                        </span>
                      )}
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

                {isExpanded && (
                  <div className="border-t border-border">
                    {/* PTO rows */}
                    {empPto.length > 0 && (
                      <div className="border-b border-border bg-amber-50/50 dark:bg-amber-950/10 px-4 py-2">
                        <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                          <Palmtree className="inline h-3 w-3 mr-1" />
                          Time off
                        </div>
                        {empPto.map((p) => (
                          <div
                            key={p.id}
                            className="text-xs text-muted-foreground"
                          >
                            {p.start_date} — {p.end_date} ({p.hours}h)
                            {p.reason ? ` · ${p.reason}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Shifts table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                            <th className="px-4 py-2 text-left font-medium">
                              Clock in
                            </th>
                            <th className="px-4 py-2 text-left font-medium">
                              Clock out
                            </th>
                            <th className="px-4 py-2 text-left font-medium">
                              Actual
                            </th>
                            <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">
                              Est.
                            </th>
                            <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">
                              Client
                            </th>
                            <th className="px-4 py-2 text-left font-medium hidden md:table-cell">
                              Arrival
                            </th>
                            <th className="px-4 py-2 text-left font-medium hidden md:table-cell">
                              Speed
                            </th>
                            <th className="px-4 py-2 text-right font-medium">
                              Earned
                            </th>
                            <th className="w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {empEntries.map((r) => (
                            <tr
                              key={r.id}
                              className="group border-b border-border last:border-0"
                            >
                              <td className="px-4 py-2.5 tabular-nums">
                                <div className="flex items-center gap-1.5">
                                  {formatDateTime(r.clock_in_at)}
                                  {r.is_manual && (
                                    <span
                                      title="Manually entered"
                                      className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                                    >
                                      M
                                    </span>
                                  )}
                                </div>
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
                                {r.is_open
                                  ? "—"
                                  : formatDurationMinutes(r.actual_minutes)}
                              </td>
                              <td className="px-4 py-2.5 tabular-nums text-muted-foreground hidden sm:table-cell">
                                {r.estimated_minutes
                                  ? formatDurationMinutes(r.estimated_minutes)
                                  : "—"}
                              </td>
                              <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">
                                {r.client_name ?? "—"}
                              </td>
                              <td className="px-4 py-2.5 hidden md:table-cell">
                                <PunctualityBadge
                                  type={r.punctuality}
                                  minutes={r.punctuality_minutes}
                                />
                              </td>
                              <td className="px-4 py-2.5 hidden md:table-cell">
                                <CompletionBadge
                                  type={r.completion}
                                  minutes={r.completion_diff_minutes}
                                />
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                                {formatCurrencyCents(r.earned_cents)}
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                <button
                                  type="button"
                                  onClick={() => openEdit(r)}
                                  aria-label="Edit entry"
                                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
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
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">
                    Employee
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Clock in
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Clock out
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Actual
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">
                    Est.
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">
                    Client
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">
                    Arrival
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">
                    Speed
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Earned
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {entries.map((r) => (
                  <tr
                    key={r.id}
                    className="group border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      <div className="flex items-center gap-1.5">
                        {r.employee_name}
                        {r.is_manual && (
                          <span
                            title="Manually entered"
                            className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                          >
                            M
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatDateTime(r.clock_in_at)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {r.is_open ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          In progress
                        </span>
                      ) : (
                        formatDateTime(r.clock_out_at)
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium tabular-nums">
                      {r.is_open
                        ? "—"
                        : formatDurationMinutes(r.actual_minutes)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground hidden sm:table-cell">
                      {r.estimated_minutes
                        ? formatDurationMinutes(r.estimated_minutes)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">
                      {r.client_name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <PunctualityBadge
                        type={r.punctuality}
                        minutes={r.punctuality_minutes}
                      />
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <CompletionBadge
                        type={r.completion}
                        minutes={r.completion_diff_minutes}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {formatCurrencyCents(r.earned_cents)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        aria-label="Edit entry"
                        className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ManualEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        editing={editingEntry}
        employees={employeeList}
        bookings={bookings}
        orgTz={orgTz}
      />
    </div>
  );
}
