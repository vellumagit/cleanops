import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { EstimatesTable, type EstimateRow } from "./estimates-table";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Estimates" };

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; client?: string }>;
}) {
  const membership = await requireMembership();
  requireCapability(membership, "invoicing");
  const tz = await getOrgTimezone(membership.organization_id);
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();
  const { archived, client } = await searchParams;
  const showArchived = archived === "1";
  const clientFilter = client?.trim() || null;

  let query = supabase.from("estimates").select(
    `
        id,
        status,
        total_cents,
        created_at,
        sent_at,
        decided_at,
        service_description,
        pdf_url,
        client:clients ( name )
      `,
  );

  // Explicit org scope — a two-org admin reads both orgs via RLS alone.
  query = query.eq("organization_id", membership.organization_id);
  // ?client= — the client page's estimate links promise this scoping.
  if (clientFilter) query = query.eq("client_id", clientFilter);

  query = showArchived
    ? query.not("archived_at" as never, "is" as never, null as never)
    : query.is("archived_at" as never, null as never);

  const { data, error } = (await query
    .order("created_at", { ascending: false })
    .limit(200)) as unknown as {
    data: Array<{
      id: string;
      status: "draft" | "sent" | "approved" | "declined" | "expired";
      total_cents: number;
      created_at: string;
      sent_at: string | null;
      decided_at: string | null;
      service_description: string | null;
      pdf_url: string | null;
      client: { name: string } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);

  const rows: EstimateRow[] = (data ?? []).map((e) => ({
    id: e.id,
    status: e.status,
    total_cents: e.total_cents,
    created_at: e.created_at,
    sent_at: e.sent_at,
    decided_at: e.decided_at,
    service_description: e.service_description,
    client_name: e.client?.name ?? "—",
    pdf_url: e.pdf_url,
  }));

  return (
    <PageShell
      title={showArchived ? "Estimates — archived" : "Estimates"}
      description={
        showArchived
          ? "Decided or expired estimates older than your archive threshold."
          : "Quotes sent to clients before they become bookings."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/estimates"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <Link
              href="/app/estimates/new"
              className={buttonVariants({ variant: "default" })}
            >
              <Plus className="h-4 w-4" />
              New estimate
            </Link>
          )}
        </div>
      }
    >
      {clientFilter && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            Filtered to {rows[0]?.client_name ?? "one client"}
          </span>
          <Link
            href="/app/estimates"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Show all estimates
          </Link>
        </div>
      )}
      <EstimatesTable tz={tz} rows={rows} canEdit={canEdit && !showArchived} />
    </PageShell>
  );
}
