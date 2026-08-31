import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { NetworkList, type NetworkContactRow } from "./network-list";

export const metadata = { title: "Network" };

/**
 * The rolodex: people who matter but aren't clients — realtors, property
 * managers, suppliers, referral partners. Deliberately NOT the clients
 * table (no bookings, no invoices, no lifecycle) and NOT the bench
 * (nothing here is ever texted a shift offer).
 */
export default async function NetworkPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  const { data } = (await supabase
    .from("network_contacts" as never)
    .select("id, name, category, company, phone, email, notes")
    .eq("organization_id" as never, membership.organization_id as never)
    .order("name" as never)
    .limit(500)) as unknown as { data: NetworkContactRow[] | null };

  return (
    <PageShell
      title="Network"
      description="Realtors, property managers, suppliers — the people who matter but aren't clients."
      actions={
        <Link
          href="/app/network/new"
          className={buttonVariants({ size: "sm" })}
        >
          <Plus className="h-4 w-4" />
          Add contact
        </Link>
      }
    >
      <NetworkList rows={data ?? []} />
    </PageShell>
  );
}
