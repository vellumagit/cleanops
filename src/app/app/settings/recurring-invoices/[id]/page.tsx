import Link from "next/link";
import { zonedYmd } from "@/lib/wall-clock";
import { getOrgTimezone } from "@/lib/org-timezone";
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
import { getOrgCurrency } from "@/lib/org-currency";
import { formatTaxRate } from "@/lib/invoice-tax";

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
  const membership = await requireMembership(["owner", "admin", "manager"]);
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

  // Tax, read on its own so the page still opens on a database that doesn't
  // have the tax columns yet.
  type TaxRow = { tax_rate_bps: number | null; tax_label: string | null };
  const tax: TaxRow | null = await (async () => {
    try {
      const res = (await supabase
        .from("invoice_series" as never)
        .select("tax_rate_bps, tax_label")
        .eq("id" as never, id as never)
        .maybeSingle()) as unknown as { data: TaxRow | null };
      return res.data;
    } catch {
      return null;
    }
  })();
  const currency = await getOrgCurrency(membership.organization_id);

  // Saved lines, in either spelling the old JSON box accepted.
  const savedLines = (Array.isArray(series.line_items) ? series.line_items : [])
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === "object")
    .map((it, i) => ({
      label: String(it.label ?? it.description ?? "").trim(),
      quantity: typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 1,
      unit_price_cents:
        typeof it.unit_price_cents === "number"
          ? Math.round(it.unit_price_cents)
          : typeof it.unit_cents === "number"
            ? Math.round(it.unit_cents)
            : 0,
      sort_order: i,
    }))
    .filter((l) => l.label !== "");

  const defaults: RecurringInvoiceFormDefaults = {
    client_id: series.client_id,
    name: series.name,
    cadence: series.cadence,
    amount_dollars: (series.amount_cents / 100).toFixed(2),
    due_days: series.due_days,
    // In the company's calendar, the same one the save reads it in.
    next_run_at: zonedYmd(new Date(series.next_run_at), await getOrgTimezone(membership.organization_id)),
    notes: series.notes ?? "",
    lines: savedLines,
    tax_rate_percent: formatTaxRate(tax?.tax_rate_bps).replace("%", ""),
    tax_label: tax?.tax_label ?? "",
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
          currency={currency}
          id={series.id}
          clients={(clients ?? []).map((c) => ({ id: c.id, name: c.name }))}
          defaults={defaults}
        />
      </div>
    </PageShell>
  );
}
