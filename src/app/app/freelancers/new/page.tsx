import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { FreelancerForm } from "../freelancer-form";

export const metadata = { title: "New freelancer" };

export default async function NewFreelancerPage() {
  await requireMembership(["owner", "admin", "manager"]);
  return (
    <PageShell
      title="New freelancer"
      description="Add a contact to your emergency-coverage bench. They do not need a Sollos account."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <FreelancerForm mode="create" />
      </div>
    </PageShell>
  );
}
