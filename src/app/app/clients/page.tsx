import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { requireMembership, requireCapability } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ArchivedToggle } from "@/components/archived-toggle";
import { ClientsTable, type ClientRow } from "./clients-table";
import { fetchOrgContactDefault } from "./org-contact-default";

export const metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const membership = await requireMembership();
  requireCapability(membership, "clients");
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();
  // Fired, not awaited — resolves while the clients query runs.
  const contactDefaultPromise = fetchOrgContactDefault(
    membership.organization_id,
  );
  const { archived } = await searchParams;
  const showArchived = archived === "1";

  // Default view shows only ACTIVE clients (archived_at IS NULL).
  // Previously the page mixed archived and active together, so an owner
  // who archived a client still saw them in the list. The ArchivedToggle
  // lets them flip into a dedicated archive view when they need history.
  let query = supabase
    .from("clients")
    .select(
      "id, name, email, phone, address, balance_cents, preferred_contact, contact_preference, sms_opted_in, created_at",
    );
  query = showArchived
    ? query.not("archived_at" as never, "is" as never, null as never)
    : query.is("archived_at" as never, null as never);

  // Leads and lost leads are client ROWS but not customers — they live at
  // /app/leads. This is the cost of modelling lifecycle as a column instead of
  // a second table, and it is one line here rather than a permanent tax on
  // every feature that touches a client.
  query = query.eq("lifecycle" as never, "client" as never);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  // contact_preference/sms_opted_in aren't in the generated types yet — cast
  // (same convention as the other new columns).
  const rows = (data ?? []) as unknown as ClientRow[];
  const orgContactDefault = await contactDefaultPromise;

  return (
    <PageShell
      title={showArchived ? "Clients — archived" : "Clients"}
      description={
        showArchived
          ? "Clients you've archived. Existing invoices remain payable."
          : "Customers your team serves."
      }
      actions={
        <div className="flex items-center gap-2">
          <ArchivedToggle
            basePath="/app/clients"
            showingArchived={showArchived}
          />
          {canEdit && !showArchived && (
            <>
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
            </>
          )}
        </div>
      }
    >
      <ClientsTable
        rows={rows}
        canEdit={canEdit && !showArchived}
        orgContactDefault={orgContactDefault}
      />
    </PageShell>
  );
}
