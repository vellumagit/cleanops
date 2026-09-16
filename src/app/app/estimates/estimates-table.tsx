"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, estimateStatusTone } from "@/components/status-badge";
import { ContactLine } from "@/components/contact-line";
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
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  pdf_url: string | null;
};

export function EstimatesTable({
  rows,
  canEdit,
  tz,
}: {
  rows: EstimateRow[];
  canEdit: boolean;
  /** Org IANA timezone — every date on this table renders in it. */
  tz: string;
}) {
  const router = useRouter();
  const columns: DataTableColumn<EstimateRow>[] = [
    {
      key: "client",
      header: "Client",
      render: (r) => (
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 font-medium">
            {r.client_name}
            {r.pdf_url && (
              <span title="PDF attached">
                <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
              </span>
            )}
          </span>
          {/* The visitor's email and phone, right on the row. A website
              estimate request used to show only the name here; reaching
              the person meant a detour through Leads. */}
          <ContactLine
            email={r.client_email}
            phone={r.client_phone}
            className="mt-0.5"
          />
        </div>
      ),
      searchValue: (r) =>
        [r.client_name, r.client_email, r.client_phone].filter(Boolean).join(" "),
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
          {formatDate(r.created_at, tz)}
        </span>
      ),
    },
    {
      key: "sent",
      header: "Sent",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.sent_at, tz)}
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
        description: "Quotes you send to clients will show up here.",
      }}
    />
  );
}
