import Link from "next/link";
import { ArrowLeft, Download, AlertTriangle } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { getOrgDeletionStatus } from "@/lib/tenant-data";
import {
  DeletionDangerZone,
  CancelDeletionButton,
} from "./danger-zone";

export const metadata = { title: "Your data" };

export default async function DataPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: { id: string; name: string } | null;
  };

  const orgName = org?.name ?? "your organization";
  const deletion = await getOrgDeletionStatus(membership.organization_id);
  const isOwner = membership.role === "owner";

  return (
    <PageShell
      title="Your data"
      description="Export what you've stored with Sollos, or permanently delete your organization."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      {/* Export */}
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold">Export everything</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Download a JSON file with every row your organization owns:
              bookings, clients, invoices, employees, payroll, chat messages,
              contracts, training — the full dataset. You can re-import it
              elsewhere, archive it, or hand it to your accountant.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The file can be large (MBs) on established accounts. It is
              generated on demand — no cached copy is stored.
            </p>
            <a
              href="/api/export"
              className={
                buttonVariants({ size: "sm" }) + " mt-4 inline-flex"
              }
            >
              <Download className="h-4 w-4" />
              Download export
            </a>
          </div>
        </div>
      </section>

      {/* Deletion pending banner */}
      {deletion.scheduled_at && !deletion.deleted_at && (
        <section className="mt-6 rounded-lg border border-red-500/40 bg-red-500/5 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-red-700">
                Deletion scheduled
              </h2>
              <p className="mt-1 text-xs text-red-700/80">
                <strong>{orgName}</strong> is scheduled for permanent
                deletion on{" "}
                <strong>
                  {deletion.purge_at
                    ? new Date(deletion.purge_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        },
                      )
                    : "an unknown date"}
                </strong>{" "}
                ({deletion.days_remaining ?? 0} day
                {deletion.days_remaining === 1 ? "" : "s"} remaining). All
                data will be wiped. You can cancel now with no data loss.
              </p>
              {isOwner && (
                <div className="mt-3">
                  <CancelDeletionButton />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Danger zone — owner only */}
      {isOwner && !deletion.scheduled_at && (
        <DeletionDangerZone orgName={orgName} />
      )}

      {!isOwner && (
        <p className="mt-6 text-xs text-muted-foreground">
          Only the organization owner can schedule or cancel deletion.
        </p>
      )}
    </PageShell>
  );
}
