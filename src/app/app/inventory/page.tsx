import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { InventoryTable, type InventoryRow } from "./inventory-table";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      `
        id,
        name,
        category,
        quantity,
        reorder_threshold,
        notes,
        assigned:memberships ( profile:profiles ( full_name ) )
      `,
    )
    .order("name", { ascending: true });

  if (error) throw error;

  const rows: InventoryRow[] = (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    reorder_threshold: i.reorder_threshold,
    notes: i.notes,
    assigned_name: i.assigned?.profile?.full_name ?? null,
  }));

  return (
    <PageShell
      title="Inventory"
      description="Cleaning supplies and equipment, with reorder thresholds."
    >
      <InventoryTable rows={rows} />
    </PageShell>
  );
}
