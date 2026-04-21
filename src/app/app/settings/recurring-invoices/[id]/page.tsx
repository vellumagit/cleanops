import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  RecurringInvoiceForm,
  type RecurringInvoiceFormDefaults,
} from "../form";

export const metadata = { title: "Edit recurring invoice" };

type SeriesRow = {
  id: string;
  client_id: string;
  name: string;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly";
  amount_cents: number;
  line_items: unknown;
  notes: string | null;
  next_run_at: string;
  due_days: number;
};

export default async function EditRecurringInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const [{ data: series }, { data: clients }] = await Promise.all([
    supabase
      .from("invoice_series" as never)
      .select(
        "id, client_id, name, cadence, amount_cents, line_items, notes, next_run_at, due_days",
      )
      .eq("id" as never, id as never)
      .maybeSingle() as unknown as Promise<{ data: SeriesRow | null }>,
    supabase.from("clients").select("id, name").order("name") as unknown as Promise<{
      data: Array<{ id: string; name: string }> | null;
    }>,
  ]);

  if (!series) notFound();

  const defaults: RecurringInvoiceFormDefaults = {
    client_id: series.client_id,
    name: series.name,
    cadence: series.cadence,
    amount_dollars: (series.amount_cents / 100).toFixed(2),
    due_days: series.due_days,
    next_run_at: series.next_run_at.slice(0, 10),
    notes: series.notes ?? "",
    line_items:
      Array.isArray(series.line_items) && series.line_items.length > 0
        ? JSON.stringify(series.line_items, null, 2)
        : "",
  };

  return (
    <PageShell
      title="Edit recurring invoice"
      description="Update the schedule, amount, or line items. Already-generated invoices are unaffected."
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
          mode="edit"
          id={series.id}
          clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))}
          defaults={defaults}
        />
      </div>
    </PageShell>
  );
}
