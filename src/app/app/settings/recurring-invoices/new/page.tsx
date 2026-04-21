import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { RecurringInvoiceForm } from "../form";

export const metadata = { title: "New recurring invoice" };

export default async function NewRecurringInvoicePage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");

  return (
    <PageShell
      title="New recurring invoice"
      description="Generates an invoice automatically on the schedule you set."
      actions={
        <Link
          href="/app/settings/recurring-invoices"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="max-w-2xl">
        <RecurringInvoiceForm
          mode="new"
          clients={(clients ?? []).map((c) => ({
            id: c.id,
            name: c.name,
          }))}
        />
      </div>
    </PageShell>
  );
}
