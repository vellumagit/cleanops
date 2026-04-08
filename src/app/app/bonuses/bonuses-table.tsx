"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, bonusStatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { markBonusPaidAction } from "./actions";

export type BonusRow = {
  id: string;
  employee_name: string | null;
  amount_cents: number;
  period_start: string;
  period_end: string;
  reason: string | null;
  status: "pending" | "paid";
  paid_at: string | null;
};

function PayCell({ id, status }: { id: string; status: "pending" | "paid" }) {
  const [pending, startTransition] = useTransition();
  if (status === "paid") return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await markBonusPaidAction(id);
          if (res.ok) toast.success("Bonus marked paid");
          else toast.error(res.error);
        })
      }
    >
      {pending ? "Saving…" : "Mark paid"}
    </Button>
  );
}

export function BonusesTable({
  rows,
  canEdit,
}: {
  rows: BonusRow[];
  canEdit: boolean;
}) {
  const columns: DataTableColumn<BonusRow>[] = [
    {
      key: "employee",
      header: "Employee",
      render: (r) => (
        <span className="font-medium">{r.employee_name ?? "—"}</span>
      ),
      searchValue: (r) => r.employee_name,
    },
    {
      key: "period",
      header: "Period",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.period_start)} → {formatDate(r.period_end)}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {r.reason ?? "—"}
        </span>
      ),
      searchValue: (r) => r.reason,
    },
    {
      key: "amount",
      header: "Amount",
      headerClassName: "text-right",
      className: "text-right tabular-nums font-medium",
      render: (r) => formatCurrencyCents(r.amount_cents),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusBadge tone={bonusStatusTone(r.status)}>
          {r.status === "paid" ? `Paid · ${formatDate(r.paid_at)}` : "Pending"}
        </StatusBadge>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      key: "actions",
      header: "",
      headerClassName: "text-right",
      className: "text-right",
      render: (r) => <PayCell id={r.id} status={r.status} />,
    });
  }

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search by employee or reason…"
      emptyState={{
        title: "No bonuses yet",
        description:
          "Run the compute job after configuring a bonus rule to award pending bonuses.",
      }}
    />
  );
}
