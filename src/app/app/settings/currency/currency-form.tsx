"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { saveCurrencyAction, type CurrencyFormState } from "./actions";

const empty: CurrencyFormState = {};

const OPTIONS = [
  {
    value: "CAD",
    label: "Canadian dollars (CAD)",
    hint: "Displays as CA$125.00.",
  },
  {
    value: "USD",
    label: "US dollars (USD)",
    hint: "Displays as US$125.00.",
  },
] as const;

export function CurrencyForm({ current }: { current: "CAD" | "USD" }) {
  const [state, formAction] = useActionState(saveCurrencyAction, empty);

  return (
    <form action={formAction} className="space-y-5 max-w-lg">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved. Amounts across the app will use the new currency.
        </div>
      )}

      <div className="space-y-2">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <input
              type="radio"
              name="currency_code"
              value={opt.value}
              defaultChecked={current === opt.value}
              className="mt-0.5 h-4 w-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</p>
            </div>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Note: Stripe payouts are settled in the currency of the Stripe
        account you connect, not this setting.
      </p>

      <div className="flex items-center justify-end">
        <SubmitButton pendingLabel="Saving…">Save currency</SubmitButton>
      </div>
    </form>
  );
}
