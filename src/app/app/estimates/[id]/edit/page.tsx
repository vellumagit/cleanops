import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { EstimateForm } from "../../estimate-form";
import { DeleteEstimateForm } from "./delete-form";

export const metadata = { title: "Edit estimate" };

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: estimate, error }, { data: clients }] = await Promise.all([
    supabase
      .from("estimates")
      .select(
        "id, client_id, service_description, notes, status, total_cents",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("clients").select("id, name").order("name"),
  ]);

  if (error) throw error;
  if (!estimate) notFound();

  return (
    <PageShell title="Edit estimate">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <EstimateForm
            mode="edit"
            id={estimate.id}
            clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
            defaults={{
              client_id: estimate.client_id,
              service_description: estimate.service_description,
              notes: estimate.notes,
              status: estimate.status,
              total_dollars: centsToDollarString(estimate.total_cents),
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will cascade to all line items on this estimate.
          </p>
          <div className="mt-4">
            <DeleteEstimateForm id={estimate.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
