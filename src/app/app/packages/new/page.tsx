import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { PackageForm } from "../package-form";

export const metadata = { title: "New package" };

export default async function NewPackagePage() {
  await requireMembership(["owner", "admin"]);
  return (
    <PageShell
      title="New package"
      description="Define a reusable service package."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <PackageForm mode="create" />
      </div>
    </PageShell>
  );
}
