import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { centsToDollarString } from "@/lib/validators/common";
import { ContractForm } from "../../contract-form";
import { fetchContractFormOptions } from "../../options";
import { DeleteContractForm } from "./delete-form";

export const metadata = { title: "Edit contract" };

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: contract, error } = await supabase
    .from("contracts")
    .select(
      "id, client_id, estimate_id, service_type, start_date, end_date, agreed_price_cents, payment_terms, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!contract) notFound();

  const { clients, estimates } = await fetchContractFormOptions();

  return (
    <PageShell title="Edit contract">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <ContractForm
            mode="edit"
            id={contract.id}
            clients={clients}
            estimates={estimates}
            defaults={{
              client_id: contract.client_id,
              estimate_id: contract.estimate_id,
              service_type: contract.service_type,
              start_date: contract.start_date,
              end_date: contract.end_date,
              agreed_price_dollars: centsToDollarString(
                contract.agreed_price_cents,
              ),
              payment_terms: contract.payment_terms,
              status: contract.status,
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will remove this contract permanently.
          </p>
          <div className="mt-4">
            <DeleteContractForm id={contract.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
