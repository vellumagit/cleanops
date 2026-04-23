"use client";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";

export type EmployeeRow = {
  id: string;
  role: "owner" | "admin" | "manager" | "employee";
  status: "active" | "invited" | "disabled";
  pay_rate_cents: number | null;
  created_at: string;
  full_name: string;
  phone: string | null;
  /** true when the membership has no linked profile — added manually
   *  by an owner/admin, can't log in. */
  is_shadow: boolean;
};

function statusTone(s: EmployeeRow["status"]): StatusTone {
  switch (s) {
    case "active":
      return "green";
    case "invited":
      return "amber";
    case "disabled":
      return "red";
  }
}

function roleTone(r: EmployeeRow["role"]): StatusTone {
  switch (r) {
    case "owner":
      return "blue";
    case "admin":
      return "blue";
    case "manager":
      return "amber";
    case "employee":
      return "neutral";
  }
}

export function EmployeesTable({ rows }: { rows: EmployeeRow[] }) {
  const columns: DataTableColumn<EmployeeRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <span className="flex items-center gap-1.5 font-medium">
          {r.full_name}
          {r.is_shadow && (
            <span
              title="Manually added — no app access"
              className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
            >
              Manual
            </span>
          )}
        </span>
      ),
      searchValue: (r) => r.full_name,
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
      key: "role",
      header: "Role",
      render: (r) => (
        <StatusBadge tone={roleTone(r.role)}>{humanizeEnum(r.role)}</StatusBadge>
      ),
      searchValue: (r) => r.role,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={statusTone(r.status)}>
          {humanizeEnum(r.status)}
        </StatusBadge>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.created_at)}
        </span>
      ),
    },
    {
      key: "pay",
      header: "Pay rate",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) =>
        r.pay_rate_cents == null
          ? "—"
          : `${formatCurrencyCents(r.pay_rate_cents)}/hr`,
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by name, phone, or role…"
      emptyState={{
        title: "No teammates yet",
        description: "Click Invite to add your first team member.",
      }}
    />
  );
}
