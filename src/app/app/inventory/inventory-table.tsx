"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";

export type InventoryRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  reorder_threshold: number;
  notes: string | null;
  assigned_name: string | null;
};

export function InventoryTable({
  rows,
  canEdit,
}: {
  rows: InventoryRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<InventoryRow>[] = [
    {
      key: "name",
      header: "Item",
      render: (r) => <span className="font-medium">{r.name}</span>,
      searchValue: (r) => r.name,
    },
    {
      key: "category",
      header: "Category",
      render: (r) => (
        <StatusBadge tone="neutral">{humanizeEnum(r.category)}</StatusBadge>
      ),
      searchValue: (r) => r.category,
    },
    {
      key: "assigned",
      header: "Assigned to",
      render: (r) => (
        <span className="text-muted-foreground">
          {r.assigned_name ?? "Shared"}
        </span>
      ),
      searchValue: (r) => r.assigned_name,
    },
    {
      key: "stock",
      header: "Stock",
      headerClassName: "text-right",
      className: "text-right tabular-nums",
      render: (r) => {
        const low = r.quantity <= r.reorder_threshold;
        return (
          <span className={low ? "font-semibold text-rose-600" : "font-medium"}>
            {r.quantity}
            <span className="ml-1 text-xs text-muted-foreground">
              / {r.reorder_threshold}
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const low = r.quantity <= r.reorder_threshold;
        return (
          <StatusBadge tone={low ? "red" : "green"}>
            {low ? "Reorder" : "In stock"}
          </StatusBadge>
        );
      },
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search inventory…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/inventory/${r.id}/edit`) : undefined
      }
      emptyState={{
        title: "No inventory yet",
        description: "Add your first item with the New item button.",
      }}
    />
  );
}
