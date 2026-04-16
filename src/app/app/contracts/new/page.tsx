import { requireMembership } from "@/lib/auth";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { ContractForm } from "../contract-form";
import { fetchContractFormOptions } from "../options";

export const metadata = { title: "New contract" };

export default async function NewContractPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { clients, estimates } = await fetchContractFormOptions();
  const currency = await getOrgCurrency(membership.organization_id);

  return (
    <PageShell title="New contract" description="Lock in a recurring engagement.">
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <ContractForm mode="create" clients={clients} estimates={estimates} currency={currency} />
      </div>
    </PageShell>
  );
}
