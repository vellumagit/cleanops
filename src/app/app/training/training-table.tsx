"use client";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";

export type TrainingRow = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  step_count: number;
  assigned: number;
  completed: number;
};

export function TrainingTable({ rows }: { rows: TrainingRow[] }) {
  const columns: DataTableColumn<TrainingRow>[] = [
    {
      key: "title",
      header: "Module",
      render: (r) => <span className="font-medium">{r.title}</span>,
      searchValue: (r) => r.title,
    },
    {
      key: "description",
      header: "Description",
      render: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {r.description ?? "—"}
        </span>
      ),
      searchValue: (r) => r.description,
    },
    {
      key: "steps",
      header: "Steps",
      render: (r) => (
        <span className="text-muted-foreground">{r.step_count}</span>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (r) => {
        if (r.assigned === 0) {
          return (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          );
        }
        const pct = Math.round((r.completed / r.assigned) * 100);
        return (
          <span className="tabular-nums text-muted-foreground">
            {r.completed}/{r.assigned}{" "}
            <span className="text-xs">({pct}%)</span>
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        if (r.assigned === 0) {
          return <StatusBadge tone="neutral">Draft</StatusBadge>;
        }
        if (r.completed === r.assigned) {
          return <StatusBadge tone="green">All complete</StatusBadge>;
        }
        return <StatusBadge tone="blue">In progress</StatusBadge>;
      },
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
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchPlaceholder="Search training modules…"
      emptyState={{
        title: "No training modules yet",
        description: "Build SOPs your team can run through in Phase 4.",
      }}
    />
  );
}
