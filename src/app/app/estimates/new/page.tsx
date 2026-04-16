import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { EstimateForm } from "../estimate-form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");

  return (
    <PageShell title="New estimate" description="Quote work for a client.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <EstimateForm
          mode="create"
          currency={currency}
          clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
        />
      </div>
    </PageShell>
  );
}
