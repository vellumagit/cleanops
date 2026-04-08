import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ClientsTable, type ClientRow } from "./clients-table";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, name, email, phone, address, balance_cents, preferred_contact, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows: ClientRow[] = data ?? [];

  return (
    <PageShell
      title="Clients"
      description="Customers your team serves."
    >
      <ClientsTable rows={rows} />
    </PageShell>
  );
}
