"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";

export type FreelancerRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  active: boolean;
  last_offered_at: string | null;
  last_accepted_at: string | null;
};

export function FreelancersTable({
  rows,
  canEdit,
}: {
  rows: FreelancerRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const columns: DataTableColumn<FreelancerRow>[] = [
    {
      key: "full_name",
      header: "Name",
      render: (r) => <span className="font-medium">{r.full_name}</span>,
      searchValue: (r) => r.full_name,
    },
    {
      key: "phone",
      header: "Phone",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">{r.phone}</span>
      ),
      searchValue: (r) => r.phone,
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
      key: "active",
      header: "Status",
      render: (r) =>
        r.active ? (
          <StatusBadge tone="green">Active</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Inactive</StatusBadge>
        ),
    },
    {
      key: "last_offered_at",
      header: "Last offered",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.last_offered_at)}
        </span>
      ),
    },
    {
      key: "last_accepted_at",
      header: "Last accepted",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.last_accepted_at)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search freelancers by name, phone, or email…"
      onRowClick={
        canEdit
          ? (r) => router.push(`/app/freelancers/${r.id}/edit`)
          : undefined
      }
      emptyState={{
        title: "No freelancers yet",
        description:
          "Add your first freelancer to the bench with the New freelancer button.",
      }}
    />
  );
}
