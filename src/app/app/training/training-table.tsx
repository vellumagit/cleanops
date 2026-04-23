"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { deleteTrainingModuleAction } from "./actions";

export type TrainingRow = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  status: string;
  step_count: number;
  assigned: number;
  completed: number;
};

function DeleteButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
        const fd = new FormData();
        fd.set("id", id);
        startTransition(() => {
          deleteTrainingModuleAction(fd);
        });
      }}
      className="rounded p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
      title="Delete module"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

export function TrainingTable({ rows }: { rows: TrainingRow[] }) {
  const columns: DataTableColumn<TrainingRow>[] = [
    {
      key: "title",
      header: "Module",
      render: (r) => (
        <Link
          href={`/app/training/${r.id}`}
          className="font-medium hover:underline"
        >
          {r.title}
        </Link>
      ),
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
      header: "Sections",
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
        if (r.status === "published") {
          return <StatusBadge tone="green">Published</StatusBadge>;
        }
        return <StatusBadge tone="neutral">Draft</StatusBadge>;
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
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <Link
            href={`/app/training/${r.id}/edit`}
            className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Edit module"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          <DeleteButton id={r.id} title={r.title} />
        </div>
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
        description:
          "Create your first module to build SOPs your team can work through.",
      }}
    />
  );
}
