import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { PackagesTable, type PackageRow } from "./packages-table";

export const metadata = { title: "Packages" };

export default async function PackagesPage() {
  await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("packages")
    .select(
      "id, name, description, duration_minutes, price_cents, is_active, included",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: PackageRow[] = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    duration_minutes: p.duration_minutes,
    price_cents: p.price_cents,
    is_active: p.is_active,
    included_count: Array.isArray(p.included) ? p.included.length : 0,
  }));

  return (
    <PageShell
      title="Packages"
      description="Reusable service packages you offer to clients."
    >
      <PackagesTable rows={rows} />
    </PageShell>
  );
}
