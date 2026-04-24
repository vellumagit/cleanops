import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrgCurrency } from "@/lib/org-currency";
import { PageShell } from "@/components/page-shell";
import { BonusRuleForm } from "./bonus-rule-form";

export const metadata = { title: "Bonus rules" };

const DEFAULTS = {
  // Review bonuses
  enabled: false,
  min_avg_rating: "4.80",
  min_reviews_count: "5",
  period_days: "30",
  amount_dollars: "50.00",
  // Efficiency bonuses
  efficiency_enabled: false,
  efficiency_min_hours_saved: "5.00",
  efficiency_min_jobs: "10",
  efficiency_amount_dollars: "25.00",
};

export default async function BonusRulesPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();
  const currency = await getOrgCurrency(membership.organization_id);

  const { data: rule } = await supabase
    .from("bonus_rules")
    .select("*")
    .eq("organization_id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: {
      enabled: boolean;
      min_avg_rating: number;
      min_reviews_count: number;
      period_days: number;
      amount_cents: number;
      efficiency_enabled?: boolean;
      efficiency_min_hours_saved?: number;
      efficiency_min_jobs?: number;
      efficiency_amount_cents?: number;
    } | null;
  };

  const defaults = rule
    ? {
        enabled: rule.enabled,
        min_avg_rating: String(rule.min_avg_rating),
        min_reviews_count: String(rule.min_reviews_count),
        period_days: String(rule.period_days),
        amount_dollars: (rule.amount_cents / 100).toFixed(2),
        efficiency_enabled: rule.efficiency_enabled ?? false,
        efficiency_min_hours_saved: String(rule.efficiency_min_hours_saved ?? 5),
        efficiency_min_jobs: String(rule.efficiency_min_jobs ?? 10),
        efficiency_amount_dollars: ((rule.efficiency_amount_cents ?? 2500) / 100).toFixed(2),
      }
    : DEFAULTS;

  return (
    <PageShell
      title="Bonus rules"
      description="Configure how performance bonuses are computed from reviews and job efficiency."
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
      <div className="max-w-3xl rounded-lg border border-border bg-card p-6">
        <BonusRuleForm defaults={defaults} currency={currency} />
      </div>
    </PageShell>
  );
}
