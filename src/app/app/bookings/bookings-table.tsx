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
  Filter,
  X,
  ChevronDown,
} from "lucide-react";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
} from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type BookingRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  service_type: string;
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

function matchesTab(row: BookingRow, tab: StatusTab): boolean {
  if (tab === "all") return true;
  if (tab === "upcoming")
    return (
      (row.status === "pending" ||
        row.status === "confirmed" ||
        row.status === "en_route") &&
      new Date(row.scheduled_at) >= new Date()
    );
  return row.status === tab;
}

export function BookingsTable({
  rows,
  canEdit,
}: {
  rows: BookingRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("table");
  const [tab, setTab] = useState<StatusTab>("all");
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // Derive unique services and assignees for dropdown filters
  const services = useMemo(
    () => [...new Set(rows.map((r) => r.service_type))].sort(),
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

  // Filter pipeline
  const filtered = useMemo(() => {
    let result = rows;

    // Tab filter
    result = result.filter((r) => matchesTab(r, tab));

    // Search
    if (query.trim()) {
      const needle = query.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.client_name.toLowerCase().includes(needle) ||
          r.service_type.toLowerCase().includes(needle) ||
          (r.assigned_name ?? "").toLowerCase().includes(needle) ||
          (r.address ?? "").toLowerCase().includes(needle),
      );
    }

    // Service filter
    if (serviceFilter !== "all") {
      result = result.filter((r) => r.service_type === serviceFilter);
    }

    // Assignee filter
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        result = result.filter((r) => !r.assigned_name);
      } else {
        result = result.filter((r) => r.assigned_name === assigneeFilter);
      }
    }

    return result;
  }, [rows, tab, query, serviceFilter, assigneeFilter]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of STATUS_TABS) {
      counts[t.key] = rows.filter((r) => matchesTab(r, t.key)).length;
    }
    return counts;
  }, [rows]);

  const hasActiveFilters =
    serviceFilter !== "all" || assigneeFilter !== "all";

  return (
    <div className="space-y-3">
      {/* Status tabs */}
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

      {/* Search + filters + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client, service, assignee, address…"
            className="pl-8 h-8 text-xs"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            showFilters || hasActiveFilters
              ? "border-foreground/20 bg-foreground/5 text-foreground"
              : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
              {(serviceFilter !== "all" ? 1 : 0) +
                (assigneeFilter !== "all" ? 1 : 0)}
            </span>
          )}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setServiceFilter("all");
              setAssigneeFilter("all");
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-input px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}

        <div className="ml-auto flex rounded-md border border-border bg-card">
          <button
            type="button"
            onClick={() => setView("table")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors rounded-l-md",
              view === "table"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Table
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
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
        </div>
      </div>

      {/* Filter dropdowns (collapsible) */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card p-3">
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Service type
            </label>
            <div className="relative mt-1">
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="h-8 appearance-none rounded-md border border-input bg-transparent pl-2.5 pr-7 text-xs"
              >
                <option value="all">All services</option>
                {services.map((s) => (
                  <option key={s} value={s}>
                    {humanizeEnum(s)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Assignee
            </label>
            <div className="relative mt-1">
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="h-8 appearance-none rounded-md border border-input bg-transparent pl-2.5 pr-7 text-xs"
              >
                <option value="all">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">No bookings yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Schedule your first job with the New booking button.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-14 text-center text-sm text-muted-foreground">
          No bookings match your filters.
        </div>
      ) : view === "table" ? (
        <TableView rows={filtered} canEdit={canEdit} router={router} />
      ) : (
        <CardsView rows={filtered} canEdit={canEdit} router={router} />
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {rows.length}
          {query && ` matching "${query}"`}
        </p>
      )}
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
}: {
  rows: BookingRow[];
  canEdit: boolean;
  router: ReturnType<typeof useRouter>;
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
                  {formatDateTime(r.scheduled_at)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium">{r.client_name}</span>
                    {r.series_id && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400"
                        title="Part of a recurring series"
                      >
                        <Repeat className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {humanizeEnum(r.service_type)}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell">
                  {formatDurationMinutes(r.duration_minutes)}
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  {r.assigned_name ? (
                    <span className="text-muted-foreground">
                      {r.assigned_name}
                    </span>
                  ) : (
                    <AssignedCell row={r} canEdit={canEdit} />
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge tone={bookingStatusTone(r.status)}>
                    {formatBookingStatus(r.status)}
                  </StatusBadge>
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
}: {
  rows: BookingRow[];
  canEdit: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, BookingRow[]>();
    for (const r of rows) {
      const dateKey = new Date(r.scheduled_at).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const existing = map.get(dateKey) ?? [];
      existing.push(r);
      map.set(dateKey, existing);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="space-y-5">
      {grouped.map(([dateLabel, dayRows]) => (
        <div key={dateLabel}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {dateLabel}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dayRows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={
                  canEdit
                    ? () => router.push(`/app/bookings/${r.id}/edit`)
                    : undefined
                }
                className={cn(
                  "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all",
                  canEdit && "cursor-pointer hover:border-foreground/20 hover:shadow-sm",
                )}
              >
                {/* Top row: client + status */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">
                        {r.client_name}
                      </span>
                      {r.series_id && (
                        <Repeat className="h-3 w-3 shrink-0 text-blue-500" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {humanizeEnum(r.service_type)}
                    </span>
                  </div>
                  <StatusBadge tone={bookingStatusTone(r.status)}>
                    {formatBookingStatus(r.status)}
                  </StatusBadge>
                </div>

                {/* Details */}
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span className="tabular-nums">
                      {new Date(r.scheduled_at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
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
                    ) : (
                      <span className="text-amber-500 font-medium">
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom: total */}
                <div className="mt-auto pt-1 border-t border-border">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCurrencyCents(r.total_cents)}
                  </span>
                </div>
              </button>
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
          title="Send to freelancer bench"
        >
          <Users className="h-3 w-3" />
          Bench
        </Link>
      )}
    </span>
  );
}
