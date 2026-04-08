import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { BonusesTable, type BonusRow } from "./bonuses-table";
import { ComputeBonusesButton } from "./compute-button";

export const metadata = { title: "Bonuses" };

export default async function BonusesPage() {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const supabase = await createSupabaseServerClient();

  const [bonusesResult, ruleResult] = await Promise.all([
    supabase
      .from("bonuses")
      .select(
        `
          id,
          amount_cents,
          period_start,
          period_end,
          reason,
          status,
          paid_at,
          employee:memberships ( profile:profiles ( full_name ) )
        `,
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("bonus_rules")
      .select("enabled, min_avg_rating, min_reviews_count, period_days, amount_cents")
      .eq("organization_id", membership.organization_id)
      .maybeSingle(),
  ]);

  if (bonusesResult.error) throw bonusesResult.error;

  const rows: BonusRow[] = (bonusesResult.data ?? []).map((b) => ({
    id: b.id,
    amount_cents: b.amount_cents,
    period_start: b.period_start,
    period_end: b.period_end,
    reason: b.reason,
    status: b.status,
    paid_at: b.paid_at,
    employee_name: b.employee?.profile?.full_name ?? null,
  }));

  const rule = ruleResult.data;

  return (
    <PageShell
      title="Bonuses"
      description="Performance bonuses earned by employees from client reviews."
      actions={canEdit ? <ComputeBonusesButton /> : null}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          {rule ? (
            rule.enabled ? (
              <>
                <span className="font-medium text-foreground">
                  Engine enabled.
                </span>{" "}
                Award ${(rule.amount_cents / 100).toFixed(2)} when an employee
                averages ≥{Number(rule.min_avg_rating).toFixed(2)} stars across
                at least {rule.min_reviews_count} reviews in the last{" "}
                {rule.period_days} days.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  Engine disabled.
                </span>{" "}
                Enable it in{" "}
                <Link
                  href="/app/settings/bonus-rules"
                  className="underline underline-offset-2"
                >
                  Settings → Bonus rules
                </Link>{" "}
                to start awarding bonuses.
              </>
            )
          ) : (
            <>
              No bonus rule configured.{" "}
              <Link
                href="/app/settings/bonus-rules"
                className={buttonVariants({ variant: "link", size: "sm" })}
              >
                Set one up
              </Link>
            </>
          )}
        </div>

        <BonusesTable rows={rows} canEdit={canEdit} />
      </div>
    </PageShell>
  );
}
