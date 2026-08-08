"use client";

import {
  isSubcontractor,
  toEngagement,
  ENGAGEMENT_LABEL,
} from "@/lib/engagement";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUrlState } from "@/components/use-url-state";
import { cn } from "@/lib/utils";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";

export type EmployeeRow = {
  id: string;
  role: "owner" | "admin" | "manager" | "employee";
  status: "active" | "invited" | "disabled";
  pay_rate_cents: number | null;
  engagement: string;
  created_at: string;
  full_name: string;
  phone: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  /** true when the membership has no linked profile — added manually
   *  by an owner/admin, can't log in. */
  is_shadow: boolean;
  /** true when this row represents the viewer (hides Disable). */
  is_self: boolean;
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

export function EmployeesTable({
  rows,
  viewerRole,
  tz,
}: {
  rows: EmployeeRow[];
  viewerRole: string;
  /** Org IANA timezone — every date on this table renders in it. */
  tz: string;
}) {
  const router = useRouter();

  /*
   * Disabled members were listed alongside everyone else, so Svit's team page
   * showed 22 people of whom 11 had left — you had to read the status badge on
   * every row to know who actually works there. Archive is the default-hidden
   * half; nothing is deleted, and the edit dialog still flips status back, so
   * restoring someone is two clicks from here.
   *
   * Invited members stay in Active: an unaccepted invitation is outstanding
   * work, not history. (Pending invitations also have their own panel above.)
   */
  const [tab, setTab] = useUrlState<"active" | "archived">("team", "active");
  const active = useMemo(
    () => rows.filter((r) => r.status !== "disabled"),
    [rows],
  );
  const archived = useMemo(
    () => rows.filter((r) => r.status === "disabled"),
    [rows],
  );
  const shown = tab === "archived" ? archived : active;

  const canEdit = viewerRole === "owner" || viewerRole === "admin";
  // Pay rates are confidential — managers can see the team list but not compensation.
  const canSeePay = viewerRole === "owner" || viewerRole === "admin";
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
        <StatusBadge tone={roleTone(r.role)}>
          {humanizeEnum(r.role)}
        </StatusBadge>
      ),
      searchValue: (r) => r.role,
    },
    {
      key: "engagement",
      header: "Engagement",
      // Worth its own column: it is the difference between someone appearing
      // in payroll and someone appearing in Subcontractor pay, and there is
      // no other place on this page to see which crew are which.
      render: (r) =>
        isSubcontractor(r.engagement) ? (
          <StatusBadge tone="neutral">Subcontractor</StatusBadge>
        ) : (
          <span className="text-muted-foreground">Employee</span>
        ),
      searchValue: (r) => ENGAGEMENT_LABEL[toEngagement(r.engagement)],
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
          {formatDate(r.created_at, tz)}
        </span>
      ),
    },
    ...(canSeePay
      ? [
          {
            key: "pay",
            header: "Pay rate",
            headerClassName: "text-right",
            className: "text-right tabular-nums font-medium",
            render: (r: EmployeeRow) =>
              r.pay_rate_cents == null
                ? "—"
                : `${formatCurrencyCents(r.pay_rate_cents)}/hr`,
          } satisfies DataTableColumn<EmployeeRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      {/* Only worth showing once somebody has actually been archived. */}
      {archived.length > 0 && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(
            [
              ["active", "Team", active.length],
              ["archived", "Archived", archived.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={shown}
        columns={columns}
        getRowId={(r) => r.id}
        // Click a row to open that person's file (owner/admin only — the file
        // page itself is gated the same way).
        onRowClick={
          canEdit ? (r) => router.push(`/app/employees/${r.id}`) : undefined
        }
        searchPlaceholder="Search by name, phone, or role…"
        emptyState={
          tab === "archived"
            ? {
                title: "Nobody archived",
                description:
                  "People you disable move here instead of cluttering the team list.",
              }
            : {
                title: "No teammates yet",
                description: "Click Invite to add your first team member.",
              }
        }
      />
    </div>
  );
}
