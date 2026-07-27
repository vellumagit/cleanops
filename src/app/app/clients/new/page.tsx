import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ClientForm } from "../client-form";
import { fetchClientFormCleaners, fetchReferralClients } from "../options";
import { fetchOrgNotificationContext } from "../org-contact-default";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const [cleaners, referralClients, orgCtx] = await Promise.all([
    fetchClientFormCleaners(),
    fetchReferralClients(),
    fetchOrgNotificationContext(membership.organization_id),
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
          orgContactDefault={orgCtx.orgDefault}
          orgSmsEnabled={orgCtx.smsEnabled}
        />
      </div>
    </PageShell>
  );
}
