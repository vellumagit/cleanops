import { PageShell, ComingSoon } from "@/components/page-shell";

export const metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <PageShell
      title="Inventory"
      description="Cleaning supplies and equipment, with reorder thresholds."
    >
      <ComingSoon phase="Phase 3b" />
    </PageShell>
  );
}
