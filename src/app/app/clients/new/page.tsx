import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { ClientForm } from "../client-form";
import { fetchClientFormCleaners } from "../options";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireMembership(["owner", "admin", "manager"]);
  const cleaners = await fetchClientFormCleaners();
  return (
    <PageShell
      title="New client"
      description="Add a customer your team can book and bill."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <ClientForm mode="create" cleaners={cleaners} />
      </div>
    </PageShell>
  );
}
