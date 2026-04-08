import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { ClientForm } from "../../client-form";
import { DeleteClientForm } from "./delete-form";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, email, phone, address, notes, preferred_contact")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!client) notFound();

  return (
    <PageShell title="Edit client" description={client.name}>
      <div className="max-w-2xl space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <ClientForm
            mode="edit"
            id={client.id}
            defaults={{
              name: client.name,
              email: client.email,
              phone: client.phone,
              address: client.address,
              notes: client.notes,
              preferred_contact: client.preferred_contact,
            }}
          />
        </div>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-sm font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Deleting this client will fail if they have bookings, estimates,
            contracts, or invoices attached. Cancel those records first.
          </p>
          <div className="mt-4">
            <DeleteClientForm id={client.id} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
