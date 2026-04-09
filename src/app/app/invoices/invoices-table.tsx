"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, invoiceStatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";

export type InvoiceRow = {
  id: string;
  status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void";
  amount_cents: number;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  client_name: string;
};

export function InvoicesTable({
  rows,
  canEdit,
}: {
  rows: InvoiceRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      key: "client",
      header: "Client",
      render: (r) => <span className="font-medium">{r.client_name}</span>,
      searchValue: (r) => r.client_name,
    },
    {
      key: "issued",
      header: "Issued",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.created_at)}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.due_date)}
        </span>
      ),
    },
    {
      key: "paid",
      header: "Paid",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.paid_at)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={invoiceStatusTone(r.status)}>
          {humanizeEnum(r.status)}
        </StatusBadge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.amount_cents),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by client…"
      onRowClick={
        canEdit ? (r) => router.push(`/app/invoices/${r.id}`) : undefined
      }
      emptyState={{
        title: "No invoices yet",
        description:
          "Invoices generated from completed bookings will show here.",
      }}
    />
  );
}
