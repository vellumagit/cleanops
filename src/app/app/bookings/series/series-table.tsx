"use client";

import { useTransition } from "react";
import { Pause, Play } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { describeRecurrence, type RecurrencePattern } from "@/lib/recurrence";
import { cancelSeriesAction } from "../actions";

export type SeriesRow = {
  id: string;
  pattern: string;
  custom_days: number[] | null;
  start_time: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  duration_minutes: number;
  service_type: string;
  total_cents: number;
  created_at: string;
  client_name: string;
  total_bookings: number;
  upcoming_bookings: number;
};

function CancelButton({ seriesId, clientName }: { seriesId: string; clientName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (
          !confirm(
            `Cancel the recurring series for "${clientName}"? All future bookings in this series will be cancelled.`,
          )
        )
          return;
        const fd = new FormData();
        fd.set("series_id", seriesId);
        startTransition(() => {
          cancelSeriesAction(fd);
        });
      }}
      className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50 dark:text-red-400"
      title="Cancel series and all future bookings"
    >
      <Pause className="h-3 w-3" />
      {pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}

export function SeriesTable({ rows }: { rows: SeriesRow[] }) {
  const columns: DataTableColumn<SeriesRow>[] = [
    {
      key: "client",
      header: "Client",
      render: (r) => <span className="font-medium">{r.client_name}</span>,
      searchValue: (r) => r.client_name,
    },
    {
      key: "schedule",
      header: "Schedule",
      render: (r) => (
        <span className="text-sm text-muted-foreground">
          {describeRecurrence(
            r.pattern as RecurrencePattern,
            r.custom_days,
            r.start_time,
          )}
        </span>
      ),
    },
    {
      key: "service",
      header: "Service",
      render: (r) => (
        <span className="text-muted-foreground">
          {humanizeEnum(r.service_type)}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      render: (r) => (
        <span className="text-muted-foreground">
          {formatDurationMinutes(r.duration_minutes)}
        </span>
      ),
    },
    {
      key: "per_visit",
      header: "Per visit",
      headerClassName: "text-right",
      className: "text-right tabular-nums",
      render: (r) => formatCurrencyCents(r.total_cents),
    },
    {
      key: "bookings",
      header: "Bookings",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.upcoming_bookings} upcoming / {r.total_bookings} total
        </span>
      ),
    },
    {
      key: "period",
      header: "Period",
      render: (r) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDate(r.starts_at)}
          {r.ends_at ? ` → ${formatDate(r.ends_at)}` : " → ongoing"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.active ? (
          <StatusBadge tone="green">Active</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Cancelled</StatusBadge>
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.active ? (
          <CancelButton seriesId={r.id} clientName={r.client_name} />
        ) : null,
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by client…"
      emptyState={{
        title: "No recurring series",
        description:
          "Create a recurring booking from the New booking form to set up automatic scheduling.",
      }}
    />
  );
}
