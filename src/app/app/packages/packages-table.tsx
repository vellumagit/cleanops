"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, formatDurationMinutes } from "@/lib/format";

export type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  is_active: boolean;
  included_count: number;
};

export function PackagesTable({
  rows,
  canEdit,
}: {
  rows: PackageRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<PackageRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium">{r.name}</span>,
      searchValue: (r) => r.name,
    },
    {
      key: "description",
      header: "Description",
      render: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {r.description ?? "—"}
        </span>
      ),
      searchValue: (r) => r.description,
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
      key: "items",
      header: "Includes",
      render: (r) => (
        <span className="text-muted-foreground">{r.included_count} items</span>
      ),
    },
    {
      key: "active",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={r.is_active ? "green" : "neutral"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusBadge>
      ),
    },
    {
      key: "price",
      header: "Price",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.price_cents),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search packages…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/packages/${r.id}/edit`) : undefined
      }
      emptyState={{
        title: "No packages yet",
        description: "Add your first service package.",
      }}
    />
  );
}
