"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, contractStatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";

export type ContractRow = {
  id: string;
  status: "active" | "ended" | "cancelled";
  service_type: string;
  start_date: string;
  end_date: string | null;
  agreed_price_cents: number;
  payment_terms: string | null;
  client_name: string;
};

export function ContractsTable({
  rows,
  canEdit,
}: {
  rows: ContractRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<ContractRow>[] = [
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
      key: "start",
      header: "Start",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.start_date)}
        </span>
      ),
    },
    {
      key: "end",
      header: "End",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.end_date)}
        </span>
      ),
    },
    {
      key: "terms",
      header: "Terms",
      render: (r) => (
        <span className="text-muted-foreground">{r.payment_terms ?? "—"}</span>
      ),
      searchValue: (r) => r.payment_terms,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={contractStatusTone(r.status)}>
          {humanizeEnum(r.status)}
        </StatusBadge>
      ),
    },
    {
      key: "price",
      header: "Price",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.agreed_price_cents),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by client, service, or terms…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/contracts/${r.id}/edit`) : undefined
      }
      emptyState={{
        title: "No contracts yet",
        description: "Recurring service agreements will live here.",
      }}
    />
  );
}
