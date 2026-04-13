"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Star, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  upsertBonusRuleAction,
  type BonusRuleFormState,
} from "./actions";

const empty: BonusRuleFormState = {};

export type BonusRuleDefaults = {
  // Review bonuses
  enabled: boolean;
  min_avg_rating: string;
  min_reviews_count: string;
  period_days: string;
  amount_dollars: string;
  // Efficiency bonuses
  efficiency_enabled: boolean;
  efficiency_min_hours_saved: string;
  efficiency_min_jobs: string;
  efficiency_amount_dollars: string;
};

export function BonusRuleForm({ defaults }: { defaults: BonusRuleDefaults }) {
  const [state, formAction] = useActionState(upsertBonusRuleAction, empty);
  const v = state.values ?? {};

  useEffect(() => {
    if (state.values && !state.errors) {
      toast.success("Bonus rules saved");
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-8">
      <FormError message={state.errors?._form} />

      {/* ── REVIEW BONUSES ── */}
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
          <Star className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Review-based bonuses</h3>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3 dark:border-violet-900/30 dark:bg-violet-950/10">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={defaults.enabled}
            className="mt-0.5 h-4 w-4 rounded border-input accent-violet-500"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Enable review bonuses</span>
            <span className="text-xs text-muted-foreground">
              Reward employees who maintain high customer ratings over a period.
            </span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Minimum average rating"
            htmlFor="min_avg_rating"
            required
            error={state.errors?.min_avg_rating}
            hint="e.g. 4.80"
          >
            <Input
              id="min_avg_rating"
              name="min_avg_rating"
              type="number"
              step="0.01"
              min={1}
              max={5}
              required
              defaultValue={v.min_avg_rating ?? defaults.min_avg_rating}
            />
          </FormField>

          <FormField
            label="Minimum review count"
            htmlFor="min_reviews_count"
            required
            error={state.errors?.min_reviews_count}
          >
            <Input
              id="min_reviews_count"
              name="min_reviews_count"
              type="number"
              min={1}
              required
              defaultValue={v.min_reviews_count ?? defaults.min_reviews_count}
            />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Period (days)"
            htmlFor="period_days"
            required
            error={state.errors?.period_days}
            hint="Window of reviews to evaluate"
          >
            <Input
              id="period_days"
              name="period_days"
              type="number"
              min={1}
              max={365}
              required
              defaultValue={v.period_days ?? defaults.period_days}
            />
          </FormField>

          <FormField
            label="Bonus amount (USD)"
            htmlFor="amount_cents"
            required
            error={state.errors?.amount_cents}
          >
            <Input
              id="amount_cents"
              name="amount_cents"
              inputMode="decimal"
              required
              defaultValue={v.amount_cents ?? defaults.amount_dollars}
            />
          </FormField>
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border" />

      {/* ── EFFICIENCY BONUSES ── */}
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <Zap className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Efficiency bonuses</h3>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/10">
          <input
            type="checkbox"
            name="efficiency_enabled"
            defaultChecked={defaults.efficiency_enabled}
            className="mt-0.5 h-4 w-4 rounded border-input accent-emerald-500"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Enable efficiency bonuses</span>
            <span className="text-xs text-muted-foreground">
              Reward employees who consistently finish jobs faster than the estimated duration. Uses clock-in/clock-out times compared to the booking&rsquo;s estimated minutes.
            </span>
          </span>
        </label>

        <div className="grid gap-5 sm:grid-cols-3">
          <FormField
            label="Min hours saved"
            htmlFor="efficiency_min_hours_saved"
            required
            error={state.errors?.efficiency_min_hours_saved}
            hint="Total across all jobs in period"
          >
            <Input
              id="efficiency_min_hours_saved"
              name="efficiency_min_hours_saved"
              type="number"
              step="0.5"
              min={0.5}
              required
              defaultValue={v.efficiency_min_hours_saved ?? defaults.efficiency_min_hours_saved}
            />
          </FormField>

          <FormField
            label="Min completed jobs"
            htmlFor="efficiency_min_jobs"
            required
            error={state.errors?.efficiency_min_jobs}
            hint="With clock-in/out data"
          >
            <Input
              id="efficiency_min_jobs"
              name="efficiency_min_jobs"
              type="number"
              min={1}
              required
              defaultValue={v.efficiency_min_jobs ?? defaults.efficiency_min_jobs}
            />
          </FormField>

          <FormField
            label="Bonus amount (USD)"
            htmlFor="efficiency_amount_cents"
            required
            error={state.errors?.efficiency_amount_cents}
          >
            <Input
              id="efficiency_amount_cents"
              name="efficiency_amount_cents"
              inputMode="decimal"
              required
              defaultValue={v.efficiency_amount_cents ?? defaults.efficiency_amount_dollars}
            />
          </FormField>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">How it works</p>
          <p className="mt-1">
            For each completed job in the period, we compare the booking&apos;s estimated duration
            against the actual clock-in → clock-out time. If an employee saves more than the threshold
            in total across enough jobs, they earn a pending efficiency bonus.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end pt-2">
        <SubmitButton pendingLabel="Saving…">Save rules</SubmitButton>
      </div>
    </form>
  );
}
