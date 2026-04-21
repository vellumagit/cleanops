"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, estimateStatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";

export type EstimateRow = {
  id: string;
  status: "draft" | "sent" | "approved" | "declined" | "expired";
  total_cents: number;
  created_at: string;
  sent_at: string | null;
  decided_at: string | null;
  service_description: string | null;
  client_name: string;
  pdf_url: string | null;
};

export function EstimatesTable({
  rows,
  canEdit,
}: {
  rows: EstimateRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<EstimateRow>[] = [
    {
      key: "client",
      header: "Client",
      render: (r) => (
        <span className="flex items-center gap-1.5 font-medium">
          {r.client_name}
          {r.pdf_url && (
            <span title="PDF attached"><FileText className="h-3.5 w-3.5 shrink-0 text-red-500" /></span>
          )}
        </span>
      ),
      searchValue: (r) => r.client_name,
    },
    {
      key: "service",
      header: "Service",
      render: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {r.service_description ?? "—"}
        </span>
      ),
      searchValue: (r) => r.service_description,
    },
    {
      key: "created",
      header: "Created",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.created_at)}
        </span>
      ),
    },
    {
      key: "sent",
      header: "Sent",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.sent_at)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={estimateStatusTone(r.status)}>
          {humanizeEnum(r.status)}
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
      searchPlaceholder="Search by client or service…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/estimates/${r.id}/edit`) : undefined
      }
      emptyState={{
        title: "No estimates yet",
        description:
          "Quotes you send to clients will show up here.",
      }}
    />
  );
}
