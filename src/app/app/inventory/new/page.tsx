import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { InventoryForm } from "../inventory-form";
import { fetchInventoryFormOptions } from "../options";

export const metadata = { title: "New inventory item" };

export default async function NewInventoryPage() {
  await requireMembership(["owner", "admin"]);
  const { members } = await fetchInventoryFormOptions();

  return (
    <PageShell
      title="New inventory item"
      description="Track supplies and equipment."
    >
      <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
        <InventoryForm mode="create" members={members} />
      </div>
    </PageShell>
  );
}
