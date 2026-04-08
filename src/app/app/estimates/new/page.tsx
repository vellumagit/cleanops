import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { EstimateForm } from "../estimate-form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage() {
  await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");

  return (
    <PageShell title="New estimate" description="Quote work for a client.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <EstimateForm
          mode="create"
          clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
        />
      </div>
    </PageShell>
  );
}
