import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Trash2 } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { NetworkContactForm } from "../../network-form";
import { deleteNetworkContactAction } from "../../actions";

export const metadata = { title: "Edit network contact" };

export default async function EditNetworkContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: contact } = (await supabase
    .from("network_contacts" as never)
    .select("id, name, category, company, phone, email, notes")
    .eq("id" as never, id as never)
    .eq("organization_id" as never, membership.organization_id as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      name: string;
      category: string;
      company: string | null;
      phone: string | null;
      email: string | null;
      notes: string | null;
    } | null;
  };

  if (!contact) notFound();

  return (
    <PageShell
      title={contact.name}
      description="Edit network contact"
      actions={
        <Link
          href="/app/network"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ChevronLeft className="h-4 w-4" />
          Network
        </Link>
      }
    >
      <div className="max-w-2xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-6">
          <NetworkContactForm
            mode="edit"
            id={contact.id}
            defaults={contact}
          />
        </div>

        <form action={deleteNetworkContactAction}>
          <input type="hidden" name="id" value={contact.id} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete contact
          </button>
        </form>
      </div>
    </PageShell>
  );
}
