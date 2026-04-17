import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ClientsTable, type ClientRow } from "./clients-table";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, name, email, phone, address, balance_cents, preferred_contact, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const rows: ClientRow[] = data ?? [];

  return (
    <PageShell
      title="Clients"
      description="Customers your team serves."
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            <Link
              href="/app/clients/import"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Link>
            <Link
              href="/app/clients/new"
              className={buttonVariants({ variant: "default" })}
            >
              <Plus className="h-4 w-4" />
              New client
            </Link>
          </div>
        ) : null
      }
    >
      <ClientsTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
