"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  Repeat,
  Search,
  LayoutList,
  LayoutGrid,
  Clock,
  MapPin,
  User,
  X,
  ChevronDown,
} from "lucide-react";
import { BookingStatusDropdown } from "./booking-status-dropdown";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { AssignCrewButton } from "./assign-crew-button";
import type { AssignableEmployee } from "./assign-crew-dialog";

export type BookingRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  service_type: string;
  /** Denormalized service name from service_types. When set, prefer
   *  this over humanizing the enum so the user sees their custom
   *  service name (e.g. "Window Cleaning" not "Other"). */
  service_type_label: string | null;
  status:
    | "pending"
    | "confirmed"
    | "en_route"
    | "in_progress"
    | "completed"
    | "cancelled";
  total_cents: number;
  client_name: string;
  assigned_name: string | null;
  /** Name of the subcontractor covering this booking (a claimed shift offer),
   *  when no member is assigned. Kept separate from assigned_name so it doesn't
   *  pollute the member assignee filter. */
  covered_by_name: string | null;
  /** Primary assignee membership id — feeds the Assign dialog's
   *  pre-filled radio so opening it shows the current state. */
  assigned_to: string | null;
  /** Non-primary crew membership ids on this booking, sourced from
   *  the booking_assignees junction. Pre-checked in the dialog. */
  additional_assignee_ids: string[];
  /** Number of split-shift segments (rows carrying split metadata). 0 or
   *  1 = not a split; 2+ renders a "Split · N" chip. */
  segment_count: number;
  series_id: string | null;
  address: string | null;
};

type ViewMode = "table" | "cards";

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]["key"];

const DATE_FILTERS = [
  { key: "all", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "past30", label: "Past 30 days" },
] as const;

type DateFilter = (typeof DATE_FILTERS)[number]["key"];

function matchesTab(row: BookingRow, tab: StatusTab): boolean {
  if (tab === "all") return true;
  if (tab === "upcoming")
    return row.status === "confirmed" && new Date(row.scheduled_at) >= new Date();
  return row.status === tab;
}

function matchesDate(row: BookingRow, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const d = new Date(row.scheduled_at);
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  if (filter === "today") {
    return d >= startOfDay && d < endOfDay;
  }
  if (filter === "week") {
    const dayOfWeek = now.getDay(); // 0=Sun
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    return d >= startOfWeek && d < endOfWeek;
  }
  if (filter === "month") {
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    );
  }
  if (filter === "past30") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    return d >= cutoff && d <= now;
  }
  return true;
}

export function BookingsTable({
  rows,
  canEdit,
  tz,
  employees,
}: {
  rows: BookingRow[];
  canEdit: boolean;
  tz: string;
  employees: AssignableEmployee[];
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("table");
  const [tab, setTab] = useState<StatusTab>("all");
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  // Derive unique values for dropdown filters.
  // Filter by the displayed label so a user typing "Window cleaning"
  // matches what their booking actually shows; falls back to the enum
  // for rows without a label (very old historical rows).
  const services = useMemo(
    () =>
      [
        ...new Set(
          rows.map((r) => r.service_type_label ?? r.service_type),
        ),
      ].sort(),
    [rows],
  );
  const assignees = useMemo(
    () =>
      [
        ...new Set(
          rows.map((r) => r.assigned_name).filter(Boolean) as string[],
        ),
      ].sort(),
    [rows],
  );
  const clients = useMemo(
    () => [...new Set(rows.map((r) => r.client_name))].sort(),
    [rows],
  );

  // Filter pipeline
  const filtered = useMemo(() => {
    let result = rows;
    // When a search query is active, bypass the tab filter so completed /
    // cancelled bookings are always findable regardless of which tab is open.
    if (!query.trim()) {
      result = result.filter((r) => matchesTab(r, tab));
    }
    result = result.filter((r) => matchesDate(r, dateFilter));

    if (query.trim()) {
      const needle = query.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.client_name.toLowerCase().includes(needle) ||
          r.service_type.toLowerCase().includes(needle) ||
          (r.service_type_label ?? "").toLowerCase().includes(needle) ||
          (r.assigned_name ?? "").toLowerCase().includes(needle) ||
          (r.address ?? "").toLowerCase().includes(needle),
      );
    }
    if (serviceFilter !== "all") {
      result = result.filter(
        (r) => (r.service_type_label ?? r.service_type) === serviceFilter,
      );
    }
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        result = result.filter((r) => !r.assigned_name);
      } else {
        result = result.filter((r) => r.assigned_name === assigneeFilter);
      }
    }
    if (clientFilter !== "all") {
      result = result.filter((r) => r.client_name === clientFilter);
    }

    return result;
  }, [rows, tab, dateFilter, query, serviceFilter, assigneeFilter, clientFilter]);

  // Tab counts (pre-date/filter, just status)
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of STATUS_TABS) {
      counts[t.key] = rows.filter((r) => matchesTab(r, t.key)).length;
    }
    return counts;
  }, [rows]);

  const activeFilterCount =
    (serviceFilter !== "all" ? 1 : 0) +
    (assigneeFilter !== "all" ? 1 : 0) +
    (clientFilter !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0);

  function clearFilters() {
    setServiceFilter("all");
    setAssigneeFilter("all");
    setClientFilter("all");
    setDateFilter("all");
    setQuery("");
  }

  return (
    <div className="space-y-3">
      {/* ── Status tabs ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 w-fit">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span
              className={cn(
                "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                tab === t.key
                  ? "bg-foreground text-background"
                  : "bg-muted-foreground/20 text-muted-foreground",
              )}
            >
              {tabCounts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {/* ── Filters row (always visible) ───────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, service, address…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Date quick-select */}
        <FilterSelect
          label="Date"
          value={dateFilter}
          onChange={(v) => setDateFilter(v as DateFilter)}
        >
          {DATE_FILTERS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </FilterSelect>

        {/* Client */}
        <FilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </FilterSelect>

        {/* Service */}
        <FilterSelect
          label="Service"
          value={serviceFilter}
          onChange={setServiceFilter}
        >
          <option value="all">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>{humanizeEnum(s)}</option>
          ))}
        </FilterSelect>

        {/* Assignee */}
        <FilterSelect
          label="Assignee"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
        >
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </FilterSelect>

        {/* Clear + view toggle */}
        <div className="flex items-center gap-2 ml-auto">
          {(activeFilterCount > 0 || query) && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
            </button>
          )}

          <div className="flex rounded-md border border-border bg-muted/40">
            <button
              type="button"
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-l-md",
                view === "table"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title="Table view"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("cards")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-r-md",
                view === "cards"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Results ────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">No bookings yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule your first job with the New booking button.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center">
          <p className="text-sm text-muted-foreground">No bookings match your filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-2 text-xs text-primary underline-offset-4 hover:underline"
          >
            Clear all filters
          </button>
          {query.trim() && (
            <p className="mt-3 text-xs text-muted-foreground">
              Older completed jobs may have been archived.{" "}
              <a
                href="?archived=1"
                className="text-primary underline-offset-4 hover:underline"
              >
                Search archived bookings
              </a>
            </p>
          )}
        </div>
      ) : view === "table" ? (
        <TableView
          rows={filtered}
          canEdit={canEdit}
          router={router}
          tz={tz}
          employees={employees}
        />
      ) : (
        <CardsView
          rows={filtered}
          canEdit={canEdit}
          router={router}
          tz={tz}
          employees={employees}
        />
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {rows.length} bookings
          {query && ` matching "${query}"`}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterSelect — compact labeled dropdown, always visible
// ---------------------------------------------------------------------------

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const isActive = value !== "all";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-8 appearance-none rounded-md border bg-transparent pl-2.5 pr-7 text-xs transition-colors",
            isActive
              ? "border-foreground/40 font-medium text-foreground"
              : "border-input text-muted-foreground",
          )}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table View
// ---------------------------------------------------------------------------

function TableView({
  rows,
  canEdit,
  router,
  tz,
  employees,
}: {
  rows: BookingRow[];
  canEdit: boolean;
  router: ReturnType<typeof useRouter>;
  tz: string;
  employees: AssignableEmployee[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                When
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Client
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                Service
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
                Duration
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                Assigned
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={
                  canEdit
                    ? () => router.push(`/app/bookings/${r.id}/edit`)
                    : undefined
                }
                className={cn(
                  "border-b border-border last:border-0",
                  canEdit &&
                    "cursor-pointer transition-colors hover:bg-muted/30",
                )}
              >
                <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                  {formatDateTime(r.scheduled_at, tz)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{r.client_name}</span>
                    {r.series_id && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400"
                        title="Recurring booking"
                      >
                        <Repeat className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {r.segment_count >= 2 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        title={`Split shift — ${r.segment_count} segments`}
                      >
                        Split · {r.segment_count}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {r.service_type_label ?? humanizeEnum(r.service_type)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                  {formatDurationMinutes(r.duration_minutes)}
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    {r.assigned_name ? (
                      <span className="text-muted-foreground">
                        {r.assigned_name}
                      </span>
                    ) : r.covered_by_name ? (
                      <span className="text-muted-foreground">
                        {r.covered_by_name}
                        <span className="ml-1 text-xs">(subcontractor)</span>
                      </span>
                    ) : (
                      <AssignedCell row={r} canEdit={canEdit} />
                    )}
                    {canEdit && employees.length > 0 && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <AssignCrewButton
                          bookingId={r.id}
                          employees={employees}
                          initialPrimaryId={r.assigned_to}
                          initialAdditionalIds={r.additional_assignee_ids}
                          seriesId={r.series_id}
                          seriesScheduledAt={r.scheduled_at}
                          variant="ghost"
                          size="sm"
                          label={r.assigned_name ? "Change" : "Assign"}
                          stopPropagation
                        />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <BookingStatusDropdown
                    bookingId={r.id}
                    status={r.status}
                    canEdit={canEdit}
                  />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {formatCurrencyCents(r.total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card View
// ---------------------------------------------------------------------------

function CardsView({
  rows,
  canEdit,
  router,
  tz,
  employees,
}: {
  rows: BookingRow[];
  canEdit: boolean;
  router: ReturnType<typeof useRouter>;
  tz: string;
  employees: AssignableEmployee[];
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, BookingRow[]>();
    for (const r of rows) {
      const dateKey = new Date(r.scheduled_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: tz,
      });
      const existing = map.get(dateKey) ?? [];
      existing.push(r);
      map.set(dateKey, existing);
    }
    return Array.from(map.entries());
  }, [rows, tz]);

  return (
    <div className="space-y-5">
      {grouped.map(([dateLabel, dayRows]) => (
        <div key={dateLabel}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {dateLabel}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dayRows.map((r) => (
              <div
                key={r.id}
                role={canEdit ? "button" : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onClick={
                  canEdit
                    ? () => router.push(`/app/bookings/${r.id}/edit`)
                    : undefined
                }
                onKeyDown={
                  canEdit
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/app/bookings/${r.id}/edit`);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all",
                  canEdit &&
                    "cursor-pointer hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">
                        {r.client_name}
                      </span>
                      {r.series_id && (
                        <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                      )}
                      {r.segment_count >= 2 && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                          title={`Split shift — ${r.segment_count} segments`}
                        >
                          Split · {r.segment_count}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {r.service_type_label ?? humanizeEnum(r.service_type)}
                    </span>
                  </div>
                  <BookingStatusDropdown
                    bookingId={r.id}
                    status={r.status}
                    canEdit={canEdit}
                  />
                </div>

                <div className="grid gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span className="tabular-nums">
                      {new Date(r.scheduled_at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: tz,
                      })}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>{formatDurationMinutes(r.duration_minutes)}</span>
                  </div>
                  {r.address && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{r.address}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 shrink-0" />
                    {r.assigned_name ? (
                      <span>{r.assigned_name}</span>
                    ) : r.covered_by_name ? (
                      <span>
                        {r.covered_by_name}{" "}
                        <span className="text-xs text-muted-foreground">
                          (subcontractor)
                        </span>
                      </span>
                    ) : (
                      <span className="text-amber-500 font-medium">
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 pt-1 border-t border-border">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCurrencyCents(r.total_cents)}
                  </span>
                  {canEdit && employees.length > 0 && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <AssignCrewButton
                        bookingId={r.id}
                        employees={employees}
                        initialPrimaryId={r.assigned_to}
                        initialAdditionalIds={r.additional_assignee_ids}
                        seriesId={r.series_id}
                        seriesScheduledAt={r.scheduled_at}
                        variant="ghost"
                        size="sm"
                        label={r.assigned_name ? "Change" : "Assign"}
                        stopPropagation
                      />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function AssignedCell({
  row,
  canEdit,
}: {
  row: BookingRow;
  canEdit: boolean;
}) {
  const isActionable =
    row.status !== "completed" && row.status !== "cancelled";
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-amber-500 text-xs font-medium">Unassigned</span>
      {isActionable && canEdit && (
        <Link
          href={`/app/bookings/${row.id}/offer`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-600 transition-colors"
          title="Send to subcontractor bench"
        >
          <Users className="h-3 w-3" />
          Bench
        </Link>
      )}
    </span>
  );
}
