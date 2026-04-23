import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { memberDisplayName } from "@/lib/member-display";
import { InventoryTable, type InventoryRow } from "./inventory-table";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
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
        assigned:memberships ( display_name, profile:profiles ( full_name ) )
      `,
    )
    .order("name", { ascending: true })
    .limit(500);

  if (error) throw error;

  const rows: InventoryRow[] = (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    reorder_threshold: i.reorder_threshold,
    notes: i.notes,
    assigned_name: i.assigned ? memberDisplayName(i.assigned) : null,
  }));

  return (
    <PageShell
      title="Inventory"
      description="Cleaning supplies and equipment, with reorder thresholds."
      actions={
        canEdit ? (
          <Link
            href="/app/inventory/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New item
          </Link>
        ) : null
      }
    >
      <InventoryTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
