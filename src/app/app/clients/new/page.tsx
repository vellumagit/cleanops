import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ClientForm } from "../client-form";
import { fetchClientFormCleaners, fetchReferralClients } from "../options";
import { fetchOrgContactDefault } from "../org-contact-default";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const [cleaners, referralClients, orgContactDefault] = await Promise.all([
    fetchClientFormCleaners(),
    fetchReferralClients(),
    fetchOrgContactDefault(membership.organization_id),
  ]);
  return (
    <PageShell
      title="New client"
      description="Add a customer your team can book and bill."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <ClientForm
          mode="create"
          cleaners={cleaners}
          referralClients={referralClients}
          orgContactDefault={orgContactDefault}
        />
      </div>
    </PageShell>
  );
}
