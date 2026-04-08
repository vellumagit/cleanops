import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { EstimatesTable, type EstimateRow } from "./estimates-table";

export const metadata = { title: "Estimates" };

export default async function EstimatesPage() {
  await requireMembership();
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
        client:clients ( name )
      `,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: EstimateRow[] = (data ?? []).map((e) => ({
    id: e.id,
    status: e.status,
    total_cents: e.total_cents,
    created_at: e.created_at,
    sent_at: e.sent_at,
    decided_at: e.decided_at,
    service_description: e.service_description,
    client_name: e.client?.name ?? "—",
  }));

  return (
    <PageShell
      title="Estimates"
      description="Quotes sent to clients before they become bookings."
    >
      <EstimatesTable rows={rows} />
    </PageShell>
  );
}
