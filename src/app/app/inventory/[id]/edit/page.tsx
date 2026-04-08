import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { InventoryForm } from "../../inventory-form";
import { fetchInventoryFormOptions } from "../../options";
import { DeleteInventoryForm } from "./delete-form";

export const metadata = { title: "Edit inventory item" };

export default async function EditInventoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: item, error } = await supabase
    .from("inventory_items")
    .select(
      "id, name, category, quantity, reorder_threshold, assigned_to, notes",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!item) notFound();

  const { members } = await fetchInventoryFormOptions();

  return (
    <PageShell title="Edit inventory item">
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <InventoryForm
            mode="edit"
            id={item.id}
            members={members}
            defaults={{
              name: item.name,
              category: item.category,
              quantity: String(item.quantity),
              reorder_threshold: String(item.reorder_threshold),
              assigned_to: item.assigned_to,
              notes: item.notes,
            }}
          />
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting will remove this item and its history.
          </p>
          <div className="mt-4">
            <DeleteInventoryForm id={item.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
