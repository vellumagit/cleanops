import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { EstimatesTable, type EstimateRow } from "./estimates-table";

export const metadata = { title: "Estimates" };

export default async function EstimatesPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("estimates")
    .select(
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
    )
    .is("archived_at" as never, null as never)
    .order("created_at", { ascending: false })
    .limit(200) as unknown as {
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
      title="Estimates"
      description="Quotes sent to clients before they become bookings."
      actions={
        canEdit ? (
          <Link
            href="/app/estimates/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New estimate
          </Link>
        ) : null
      }
    >
      <EstimatesTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
