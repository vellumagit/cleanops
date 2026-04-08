"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  upsertBonusRuleAction,
  type BonusRuleFormState,
} from "./actions";

const empty: BonusRuleFormState = {};

export type BonusRuleDefaults = {
  enabled: boolean;
  min_avg_rating: string;
  min_reviews_count: string;
  period_days: string;
  amount_dollars: string;
};

export function BonusRuleForm({ defaults }: { defaults: BonusRuleDefaults }) {
  const [state, formAction] = useActionState(upsertBonusRuleAction, empty);
  const v = state.values ?? {};

  useEffect(() => {
    if (state.values && !state.errors) {
      toast.success("Bonus rule saved");
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <FormError message={state.errors?._form} />

      <label className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={defaults.enabled}
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Enable bonus engine</span>
          <span className="text-xs text-muted-foreground">
            When enabled, the compute action on the Bonuses page creates pending
            bonuses for any employee who clears the thresholds below.
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

      <div className="flex items-center justify-end pt-2">
        <SubmitButton pendingLabel="Saving…">Save rule</SubmitButton>
      </div>
    </form>
  );
}
