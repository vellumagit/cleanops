import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { memberDisplayName } from "@/lib/member-display";
import {
  AuditExportButton,
  type AuditExportRow,
} from "./audit-export-button";

export const metadata = { title: "Audit log" };

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  actor:
    | {
        id: string;
        role: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      }
    | null;
};

function formatActor(row: AuditRow): string {
  if (!row.actor) return "system";
  const name = memberDisplayName(row.actor);
  // memberDisplayName returns "Unknown" when there's no name anywhere;
  // preserve the existing fallback to "member <shortid>" in that case
  // so ops can still trace a row to a specific membership id.
  if (name === "Unknown") return `member ${row.actor.id.slice(0, 8)}`;
  return name;
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  status_change: "Changed status",
  convert: "Converted",
  mark_paid: "Marked paid",
  assign: "Assigned",
  invite: "Invited",
  deactivate: "Deactivated",
};

const EXPORT_LIMIT = 2000;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; from?: string; to?: string }>;
}) {
  // Owner / admin only — Postgres RLS would also block employees, but failing
  // fast at the page level keeps the URL out of the browser history.
  await requireMembership(["owner", "admin"]);

  const params = await searchParams;
  const actionFilter =
    params.action && ACTION_LABEL[params.action] ? params.action : null;
  // Date inputs are YYYY-MM-DD; widen `to` to the end of that day.
  const fromFilter = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? "")
    ? params.from!
    : null;
  const toFilter = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? "")
    ? params.to!
    : null;
  const hasFilters = Boolean(actionFilter || fromFilter || toFilter);

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select(
      `
        id,
        created_at,
        action,
        entity,
        entity_id,
        before,
        after,
        actor:memberships (
          id,
          role,
          display_name,
          profile:profiles ( full_name )
        )
      `,
    )
    .order("created_at", { ascending: false })
    // When filtering, allow a deeper window for CSV export; otherwise the
    // default recent slice keeps the page light.
    .limit(hasFilters ? EXPORT_LIMIT : 200);

  if (actionFilter) query = query.eq("action", actionFilter);
  if (fromFilter) query = query.gte("created_at", `${fromFilter}T00:00:00`);
  if (toFilter) query = query.lte("created_at", `${toFilter}T23:59:59.999`);

  const { data, error } = await query;

  if (error) {
    return (
      <PageShell title="Audit log" description="Append-only sensitive activity">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Could not load audit log: {error.message}
        </div>
      </PageShell>
    );
  }

  const rows = (data ?? []) as unknown as AuditRow[];

  const exportRows: AuditExportRow[] = rows.map((row) => {
    const detail =
      (row.after as Record<string, unknown> | null) ??
      (row.before as Record<string, unknown> | null) ??
      null;
    return {
      when: formatTimestamp(row.created_at),
      actor: formatActor(row),
      role: row.actor?.role ?? "",
      action: ACTION_LABEL[row.action] ?? row.action,
      entity: row.entity,
      entityId: row.entity_id ?? "",
      details: detail ? JSON.stringify(detail) : "",
    };
  });

  return (
    <PageShell
      title="Audit log"
      description={
        hasFilters
          ? `Append-only record of sensitive mutations. ${rows.length} matching event${rows.length === 1 ? "" : "s"}.`
          : "Append-only record of sensitive mutations. Most recent 200 events."
      }
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      {/* Filter + export bar */}
      <form
        method="GET"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">Action</span>
          <select
            name="action"
            defaultValue={actionFilter ?? ""}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">From</span>
          <input
            type="date"
            name="from"
            defaultValue={fromFilter ?? ""}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">To</span>
          <input
            type="date"
            name="to"
            defaultValue={toFilter ?? ""}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
        <button
          type="submit"
          className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          Apply
        </button>
        {hasFilters && (
          <Link
            href="/app/settings/audit-log"
            className="h-8 rounded-md border border-border px-3 text-xs font-medium leading-8 transition-colors hover:bg-muted"
          >
            Clear
          </Link>
        )}
        <div className="ml-auto">
          <AuditExportButton
            rows={exportRows}
            filename={`audit-log${
              hasFilters
                ? `-${fromFilter ?? "all"}_${toFilter ?? "all"}`
                : ""
            }.csv`}
          />
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium">
            {hasFilters ? "No events match these filters" : "No audit events yet"}
          </p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            {hasFilters ? (
              "Try widening the date range or clearing the action filter."
            ) : (
              <>
                Sensitive mutations — creating clients, marking invoices paid,
                deleting records — write a row here as they happen.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const detail =
                  (row.after as Record<string, unknown> | null) ??
                  (row.before as Record<string, unknown> | null) ??
                  null;
                return (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground tabular-nums">
                      {formatTimestamp(row.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span className="font-medium">{formatActor(row)}</span>
                      {row.actor?.role && (
                        <span className="ml-1 text-muted-foreground">
                          ({row.actor.role})
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium">
                        {ACTION_LABEL[row.action] ?? row.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span className="font-medium">{row.entity}</span>
                      {row.entity_id && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {row.entity_id.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {detail ? (
                        <code className="block max-w-md truncate font-mono text-[10px]">
                          {JSON.stringify(detail)}
                        </code>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
