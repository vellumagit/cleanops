import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { ServicesPanel, type ServiceTypeRow } from "./services-panel";

export const metadata = { title: "Services" };

/**
 * Owner-/admin-managed catalog of services this org offers.
 *
 * The 8 baseline services that every org starts with are seeded at
 * migration time. Owners can rename, edit pricing/duration defaults,
 * archive ones they don't offer, and add their own (e.g. "Window
 * cleaning", "Pool cleaning", "Office turnover").
 *
 * Booked services keep a denormalized name on the booking row, so
 * archiving a service here does NOT break the display of historical
 * bookings that used it.
 */
export default async function ServicesPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  // We show archived rows too, in a separate section, so admins can
  // unarchive them. Active rows lead the list.
  const { data: rows } = (await supabase
    .from("service_types" as never)
    .select(
      "id, category, name, description, default_duration_minutes, default_price_cents, color, sort_order, is_active, archived_at, created_at",
    )
    .eq("organization_id" as never, membership.organization_id as never)
    .order("is_active" as never, { ascending: false } as never)
    .order("sort_order" as never, { ascending: true } as never)
    .order("name" as never, { ascending: true } as never)) as unknown as {
    data: ServiceTypeRow[] | null;
  };

  const services = rows ?? [];

  return (
    <PageShell
      title="Services"
      description="The list of services that show up when creating a booking or contract. Edit, reorder, or add your own."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <ServicesPanel services={services} currency={currency} />
    </PageShell>
  );
}
