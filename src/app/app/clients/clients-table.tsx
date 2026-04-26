"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyCents, humanizeEnum } from "@/lib/format";

export type ClientRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  balance_cents: number;
  preferred_contact: string;
  created_at: string;
};

export function ClientsTable({
  rows,
  canEdit,
}: {
  rows: ClientRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<ClientRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => <span className="font-medium">{r.name}</span>,
      searchValue: (r) => r.name,
    },
    {
      key: "email",
      header: "Email",
      render: (r) => (
        <span className="text-muted-foreground">{r.email ?? "—"}</span>
      ),
      searchValue: (r) => r.email,
    },
    {
      key: "phone",
      header: "Phone",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.phone ?? "—"}
        </span>
      ),
      searchValue: (r) => r.phone,
    },
    {
      key: "preferred_contact",
      header: "Prefers",
      render: (r) => (
        <StatusBadge tone="neutral">
          {humanizeEnum(r.preferred_contact)}
        </StatusBadge>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.balance_cents),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search clients by name, email, or phone…"
      onRowClick={(r) => router.push(`/app/clients/${r.id}`)}
      emptyState={{
        title: "No clients yet",
        description: "Add your first client with the New client button.",
      }}
    />
  );
}
