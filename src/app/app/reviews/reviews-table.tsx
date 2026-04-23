"use client";

import { useState } from "react";
import { Pencil, Star } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ReviewEditDialog } from "./review-edit-dialog";

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  submitted_at: string;
  client_name: string;
  employee_name: string | null;
};

function ratingTone(rating: number): StatusTone {
  if (rating >= 5) return "green";
  if (rating >= 4) return "blue";
  if (rating >= 3) return "amber";
  return "red";
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3.5 w-3.5",
            n <= rating
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

export function ReviewsTable({
  rows,
  canEdit = false,
}: {
  rows: ReviewRow[];
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState<ReviewRow | null>(null);

  const columns: DataTableColumn<ReviewRow>[] = [
    {
      key: "client",
      header: "Client",
      render: (r) => <span className="font-medium">{r.client_name}</span>,
      searchValue: (r) => r.client_name,
    },
    {
      key: "employee",
      header: "Employee",
      render: (r) => (
        <span className="text-muted-foreground">
          {r.employee_name ?? "—"}
        </span>
      ),
      searchValue: (r) => r.employee_name,
    },
    {
      key: "rating",
      header: "Rating",
      render: (r) => <Stars rating={r.rating} />,
    },
    {
      key: "comment",
      header: "Comment",
      render: (r) => (
        <span className="line-clamp-1 text-muted-foreground">
          {r.comment ?? "—"}
        </span>
      ),
      searchValue: (r) => r.comment,
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(r.submitted_at)}
        </span>
      ),
    },
    {
      key: "tone",
      header: "Score",
      headerClassName: "text-right",
      className: "text-right",
      render: (r) => (
        <StatusBadge tone={ratingTone(r.rating)}>
          {r.rating.toFixed(1)}
        </StatusBadge>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      key: "actions",
      header: "",
      className: "text-right",
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditing(r)}
          aria-label="Edit review"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ),
    });
  }

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search by client, employee, or comment…"
        emptyState={{
          title: "No reviews yet",
          description: "Reviews collected after jobs will land here.",
        }}
      />
      <ReviewEditDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        review={
          editing
            ? {
                id: editing.id,
                rating: editing.rating,
                comment: editing.comment,
                client_name: editing.client_name,
              }
            : null
        }
      />
    </>
  );
}
