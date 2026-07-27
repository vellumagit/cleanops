"use client";

import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, invoiceStatusTone } from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDate,
  humanizeEnum,
  type CurrencyCode,
} from "@/lib/format";

export type InvoiceRow = {
  id: string;
  status:
    | "draft"
    | "sent"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "void"
    | "refunded";
  amount_cents: number;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  client_name: string;
  /** Auto-send outcome for undelivered drafts: skipped = needs the owner
   *  (amber), held = paused deliberately (neutral). Null = nothing to say. */
  delivery: { kind: "skipped" | "held"; note: string } | null;
};

export function InvoicesTable({
  rows,
  canEdit,
  currency,
}: {
  rows: InvoiceRow[];
  canEdit: boolean;
  currency: CurrencyCode;
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
        <div className="flex flex-col items-start gap-1">
          <StatusBadge tone={invoiceStatusTone(r.status)}>
            {humanizeEnum(r.status)}
          </StatusBadge>
          {r.delivery?.kind === "skipped" && (
            <span
              title={r.delivery.note}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            >
              <TriangleAlert className="h-3 w-3" />
              Needs manual delivery
            </span>
          )}
          {r.delivery?.kind === "held" && (
            <span
              title={r.delivery.note}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              Auto-send paused
            </span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.amount_cents, currency),
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
