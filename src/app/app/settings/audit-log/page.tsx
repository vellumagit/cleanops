import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";

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
        profile: { full_name: string | null } | null;
      }
    | null;
};

function formatActor(row: AuditRow): string {
  if (!row.actor) return "system";
  return row.actor.profile?.full_name ?? `member ${row.actor.id.slice(0, 8)}`;
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

export default async function AuditLogPage() {
  // Owner / admin only — Postgres RLS would also block employees, but failing
  // fast at the page level keeps the URL out of the browser history.
  await requireMembership(["owner", "admin"]);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
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
          profile:profiles ( full_name )
        )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(200);

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

  return (
    <PageShell
      title="Audit log"
      description="Append-only record of sensitive mutations. Most recent 200 events."
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
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium">No audit events yet</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Sensitive mutations — creating clients, marking invoices paid,
            deleting records — write a row here as they happen.
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
