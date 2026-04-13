import Link from "next/link";
import { Star, Zap } from "lucide-react";
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
          bonus_type,
          employee:memberships ( profile:profiles ( full_name ) )
        ` as never,
      )
      .order("created_at", { ascending: false })
      .limit(200) as unknown as {
      data:
        | {
            id: string;
            amount_cents: number;
            period_start: string;
            period_end: string;
            reason: string | null;
            status: string;
            paid_at: string | null;
            bonus_type: string;
            employee: { profile: { full_name: string | null } | null } | null;
          }[]
        | null;
      error: { message: string } | null;
    },
    supabase
      .from("bonus_rules")
      .select(
        "enabled, min_avg_rating, min_reviews_count, period_days, amount_cents, efficiency_enabled, efficiency_min_hours_saved, efficiency_min_jobs, efficiency_amount_cents",
      )
      .eq("organization_id", membership.organization_id)
      .maybeSingle() as unknown as {
      data: {
        enabled: boolean;
        min_avg_rating: number;
        min_reviews_count: number;
        period_days: number;
        amount_cents: number;
        efficiency_enabled: boolean;
        efficiency_min_hours_saved: number;
        efficiency_min_jobs: number;
        efficiency_amount_cents: number;
      } | null;
    },
  ]);

  if (bonusesResult.error) throw bonusesResult.error;

  const rows: BonusRow[] = (bonusesResult.data ?? []).map((b) => ({
    id: b.id,
    amount_cents: b.amount_cents,
    period_start: b.period_start,
    period_end: b.period_end,
    reason: b.reason,
    status: b.status as "pending" | "paid",
    paid_at: b.paid_at,
    bonus_type: b.bonus_type ?? "review",
    employee_name: b.employee?.profile?.full_name ?? null,
  }));

  const rule = ruleResult.data;

  return (
    <PageShell
      title="Bonuses"
      description="Performance bonuses earned by employees."
      actions={canEdit ? <ComputeBonusesButton /> : null}
    >
      <div className="space-y-4">
        {/* Rule summary cards */}
        {rule ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Review bonus card */}
            <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
              <div className="mb-2 flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-xs font-semibold text-foreground">
                  Review bonuses
                </span>
              </div>
              {rule.enabled ? (
                <p>
                  Award ${(rule.amount_cents / 100).toFixed(2)} when an employee
                  averages ≥{Number(rule.min_avg_rating).toFixed(2)} stars
                  across at least {rule.min_reviews_count} reviews in the last{" "}
                  {rule.period_days} days.
                </p>
              ) : (
                <p>
                  Disabled.{" "}
                  <Link
                    href="/app/settings/bonus-rules"
                    className="underline underline-offset-2"
                  >
                    Enable →
                  </Link>
                </p>
              )}
            </div>

            {/* Efficiency bonus card */}
            <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
              <div className="mb-2 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-xs font-semibold text-foreground">
                  Efficiency bonuses
                </span>
              </div>
              {rule.efficiency_enabled ? (
                <p>
                  Award $
                  {(rule.efficiency_amount_cents / 100).toFixed(2)} when an
                  employee saves ≥{Number(rule.efficiency_min_hours_saved)}h
                  across at least {rule.efficiency_min_jobs} jobs in the last{" "}
                  {rule.period_days} days.
                </p>
              ) : (
                <p>
                  Disabled.{" "}
                  <Link
                    href="/app/settings/bonus-rules"
                    className="underline underline-offset-2"
                  >
                    Enable →
                  </Link>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            No bonus rules configured.{" "}
            <Link
              href="/app/settings/bonus-rules"
              className={buttonVariants({ variant: "link", size: "sm" })}
            >
              Set them up
            </Link>
          </div>
        )}

        <BonusesTable rows={rows} canEdit={canEdit} />
      </div>
    </PageShell>
  );
}
