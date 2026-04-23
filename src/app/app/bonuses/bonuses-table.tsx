"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Star, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, bonusStatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { markBonusPaidAction } from "./actions";
import {
  BonusDialog,
  type BonusEmployeeOption,
  type EditingBonus,
} from "./bonus-dialog";

export type BonusRow = {
  id: string;
  employee_name: string | null;
  amount_cents: number;
  period_start: string;
  period_end: string;
  reason: string | null;
  status: "pending" | "paid";
  paid_at: string | null;
  bonus_type: string;
};

function TypeBadge({ type }: { type: string }) {
  if (type === "efficiency") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Zap className="h-2.5 w-2.5" />
        Efficiency
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
      <Star className="h-2.5 w-2.5" />
      Review
    </span>
  );
}

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
  employees,
}: {
  rows: BonusRow[];
  canEdit: boolean;
  employees: BonusEmployeeOption[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<EditingBonus | null>(null);

  function openCreate() {
    setDialogMode("create");
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(row: BonusRow) {
    setDialogMode("edit");
    setEditing({
      id: row.id,
      employee_name: row.employee_name,
      amount_cents: row.amount_cents,
      reason: row.reason,
    });
    setDialogOpen(true);
  }

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
      key: "type",
      header: "Type",
      render: (r) => <TypeBadge type={r.bonus_type} />,
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
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <PayCell id={r.id} status={r.status} />
          <button
            type="button"
            onClick={() => openEdit(r)}
            aria-label="Edit bonus"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            Add bonus
          </Button>
        </div>
      )}
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search by employee or reason…"
        emptyState={{
          title: "No bonuses yet",
          description:
            "Run the compute job after configuring a bonus rule, or add one manually.",
          action: canEdit ? (
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add bonus manually
            </Button>
          ) : undefined,
        }}
      />
      <BonusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        editing={editing}
        employees={employees}
      />
    </div>
  );
}
