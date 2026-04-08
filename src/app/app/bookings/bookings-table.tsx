"use client";

import { useRouter } from "next/navigation";
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
      render: (r) => <span className="font-medium">{r.client_name}</span>,
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
      render: (r) => (
        <span className="text-muted-foreground">
          {r.assigned_name ?? "Unassigned"}
        </span>
      ),
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
