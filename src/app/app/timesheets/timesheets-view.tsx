"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  Trash2,
  Clock,
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
  OpenShift,
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
  jobMinutes: number; // clocked against a booking (cleaning)
  otherMinutes: number; // off-job (manager / admin / etc.)
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
      jobMinutes: 0,
      otherMinutes: 0,
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
    if (e.booking_id) existing.jobMinutes += e.actual_minutes;
    else existing.otherMinutes += e.actual_minutes;
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

const CATEGORY_LABELS: Record<string, string> = {
  manager: "Manager / admin",
  admin: "Admin",
  training: "Training",
  travel: "Travel",
  supplies: "Supplies / errand",
  other: "Other work",
};
/** Label for an off-job entry (no booking): its category, else a fallback. */
function categoryLabel(cat: string | null): string {
  return cat ? (CATEGORY_LABELS[cat] ?? "Off-job") : "Off-job";
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
  openShifts,
  orgTz,
  from,
  to,
}: {
  entries: TimesheetEntry[];
  employees: Record<string, EmployeeMeta>;
  ptoEntries: PtoEntry[];
  bookings: BookingOption[];
  openShifts: OpenShift[];
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

  // Bulk-select state — entry IDs currently checked for bulk deletion.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} time ${
          selectedIds.size === 1 ? "entry" : "entries"
        }? This can't be undone.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    selectedIds.forEach((id) => fd.append("ids", id));
    setBulkPending(true);
    try {
      const { bulkDeleteTimeEntriesAction } = await import("./actions");
      const result = await bulkDeleteTimeEntriesAction(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted ${result.deleted ?? selectedIds.size} entries.`);
      setSelectedIds(new Set());
      router.refresh();
    } finally {
      setBulkPending(false);
    }
  }

  async function handleCloseOpenShift(shiftId: string) {
    const endLocal = prompt(
      "End time for this shift (YYYY-MM-DD HH:MM, org timezone):",
      new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " "),
    );
    if (!endLocal) return;
    // Accept both space and T separator; the action's parser handles ISO format.
    const fd = new FormData();
    fd.set("id", shiftId);
    fd.set("end_at", endLocal.replace(" ", "T"));
    const { closeOpenShiftAction } = await import("./actions");
    const result = await closeOpenShiftAction(fd);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Shift closed.");
    router.refresh();
  }

  const employeeList = Object.values(employees).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Row-level filters applied on top of the date-range page filter.
  const [empFilter, setEmpFilter] = useState<string>("all");
  const [manualOnly, setManualOnly] = useState(false);

  const filteredEntries = entries.filter((e) => {
    if (empFilter !== "all" && e.employee_id !== empFilter) return false;
    if (manualOnly && !e.is_manual) return false;
    return true;
  });

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

  const summaries = buildSummaries(filteredEntries, employees, ptoEntries);

  const totalHours = Math.round(
    filteredEntries.reduce((sum, e) => sum + e.actual_minutes, 0) / 60,
  );
  const totalEarned = filteredEntries.reduce((sum, e) => sum + e.earned_cents, 0);
  const filteredPto = empFilter === "all"
    ? ptoEntries.filter((p) => p.status === "approved")
    : ptoEntries.filter((p) => p.status === "approved" && p.employee_id === empFilter);
  const totalPtoHours = filteredPto.reduce((sum, p) => sum + p.hours, 0);

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
    const csv = generateCSV(filteredEntries);
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
      {/* ─── Open shifts (forgotten clock-outs) ──────────────── */}
      {openShifts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="flex-1 space-y-2">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {openShifts.length === 1
                  ? "1 forgotten clock-out"
                  : `${openShifts.length} forgotten clock-outs`}
              </div>
              <p className="text-xs text-amber-900/80 dark:text-amber-300/80">
                These employees clocked in but never clocked out. Each open
                shift inflates payroll until you close it.
              </p>
              <ul className="space-y-1.5 text-xs">
                {openShifts.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/60 px-2.5 py-1.5 dark:bg-black/20"
                  >
                    <span className="text-amber-900 dark:text-amber-200">
                      <span className="font-medium">{s.employee_name}</span>
                      <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                        clocked in {formatDateTime(s.clock_in_at, orgTz)}
                      </span>
                      {s.client_name && (
                        <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                          · {s.client_name}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCloseOpenShift(s.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-700 px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
                    >
                      Close shift
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ─── Bulk selection bar (shown only when at least 1 row selected) ─ */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-lg border border-foreground/20 bg-foreground px-4 py-2.5 text-background shadow-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs underline-offset-2 hover:underline"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {bulkPending ? "Deleting…" : "Delete selected"}
            </button>
          </div>
        </div>
      )}

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

      {/* ─── Row filters ───────────────────────────────────── */}
      {employeeList.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Employee
            </label>
            <select
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-xs"
            >
              <option value="all">All employees</option>
              {employeeList.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(e) => setManualOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            Manual entries only
          </label>
          {(empFilter !== "all" || manualOnly) && (
            <button
              type="button"
              onClick={() => { setEmpFilter("all"); setManualOnly(false); }}
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

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

      {filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
          <p>
            {entries.length === 0
              ? "No time entries in this period."
              : "No entries match the current filters."}
          </p>
          {entries.length === 0 && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Log hours manually
            </button>
          )}
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
                      {emp.otherMinutes > 0 && (
                        <span>
                          {Math.round((emp.jobMinutes / 60) * 10) / 10}h jobs ·{" "}
                          <span className="text-violet-600 dark:text-violet-300">
                            {Math.round((emp.otherMinutes / 60) * 10) / 10}h other
                          </span>
                        </span>
                      )}
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
                            <th className="px-2 py-2 text-left font-medium w-6">
                              <input
                                type="checkbox"
                                aria-label="Select all entries for this employee"
                                onChange={(e) => {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      for (const r of empEntries) next.add(r.id);
                                    } else {
                                      for (const r of empEntries) next.delete(r.id);
                                    }
                                    return next;
                                  });
                                }}
                                checked={
                                  empEntries.length > 0 &&
                                  empEntries.every((r) => selectedIds.has(r.id))
                                }
                              />
                            </th>
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
                              className={cn(
                                "group border-b border-border last:border-0",
                                selectedIds.has(r.id) && "bg-muted/40",
                              )}
                            >
                              <td className="px-2 py-2.5">
                                <input
                                  type="checkbox"
                                  aria-label="Select entry"
                                  checked={selectedIds.has(r.id)}
                                  onChange={() => toggleSelected(r.id)}
                                />
                              </td>
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
                                {r.client_name ?? categoryLabel(r.work_category)}
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
                  <th className="px-2 py-2.5 text-left font-medium w-6">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            for (const r of filteredEntries) next.add(r.id);
                          } else {
                            for (const r of filteredEntries) next.delete(r.id);
                          }
                          return next;
                        });
                      }}
                      checked={
                        filteredEntries.length > 0 &&
                        filteredEntries.every((r) => selectedIds.has(r.id))
                      }
                    />
                  </th>
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
                {filteredEntries.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "group border-b border-border last:border-0",
                      selectedIds.has(r.id) && "bg-muted/40",
                    )}
                  >
                    <td className="px-2 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select entry"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelected(r.id)}
                      />
                    </td>
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
                      {r.client_name ?? categoryLabel(r.work_category)}
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
