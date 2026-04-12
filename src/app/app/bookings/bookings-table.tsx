"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, Repeat } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
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
};

export function BookingsTable({
  rows,
  canEdit,
}: {
  rows: BookingRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<BookingRow>[] = [
    {
      key: "scheduled",
      header: "When",
      render: (r) => (
        <span className="tabular-nums">{formatDateTime(r.scheduled_at)}</span>
      ),
      searchValue: (r) => r.scheduled_at,
    },
    {
      key: "client",
      header: "Client",
      render: (r) => (
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
      ),
      searchValue: (r) => r.client_name,
    },
    {
      key: "service",
      header: "Service",
      render: (r) => (
        <span className="text-muted-foreground">
          {humanizeEnum(r.service_type)}
        </span>
      ),
      searchValue: (r) => r.service_type,
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
      key: "assigned",
      header: "Assigned",
      render: (r) => {
        if (r.assigned_name) {
          return (
            <span className="text-muted-foreground">{r.assigned_name}</span>
          );
        }
        // Unassigned — show "Send to bench" button
        const isActionable =
          r.status !== "completed" && r.status !== "cancelled";
        return (
          <span className="flex items-center gap-1.5">
            <span className="text-amber-500 text-xs font-medium">
              Unassigned
            </span>
            {isActionable && canEdit && (
              <Link
                href={`/app/bookings/${r.id}/offer`}
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
      },
      searchValue: (r) => r.assigned_name,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={bookingStatusTone(r.status)}>
          {formatBookingStatus(r.status)}
        </StatusBadge>
      ),
    },
    {
      key: "total",
      header: "Total",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.total_cents),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by client, service, or assignee…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/bookings/${r.id}/edit`) : undefined
      }
      emptyState={{
        title: "No bookings yet",
        description: "Schedule your first job with the New booking button.",
      }}
    />
  );
}
