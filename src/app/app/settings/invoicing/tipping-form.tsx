"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormError } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { saveTippingAction, type TippingFormState } from "./actions";

const empty: TippingFormState = {};

/** What an owner can offer. Beyond this the picker gets too wide to tap. */
const PRESET_CHOICES = [5, 10, 15, 18, 20, 25];
const MAX_CHOSEN = 4;

export function TippingForm(props: {
  enabled: boolean;
  presets: number[];
  stripeConnected: boolean;
}) {
  const [state, formAction] = useActionState(saveTippingAction, empty);

  // Controlled, and re-seeded from the server on save — the same fix the
  // auto-send form above needed. Uncontrolled inputs snap back to their
  // first-mount values after useActionState re-renders, which reads exactly
  // like the save was ignored.
  const [enabled, setEnabled] = useState(props.enabled);
  const [presets, setPresets] = useState<number[]>(props.presets);

  const savedSignature = `${props.enabled}|${props.presets.join(",")}`;
  const [seenSignature, setSeenSignature] = useState(savedSignature);
  if (savedSignature !== seenSignature) {
    setSeenSignature(savedSignature);
    setEnabled(props.enabled);
    setPresets(props.presets);
  }

  const toggle = (p: number) => {
    setPresets((cur) =>
      cur.includes(p)
        ? cur.filter((x) => x !== p)
        : cur.length >= MAX_CHOSEN
          ? cur
          : [...cur, p].sort((a, b) => a - b),
    );
  };

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          Saved.
        </div>
      )}

      {!props.stripeConnected && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          Tipping rides on Stripe checkout. Connect Stripe under{" "}
          <span className="font-medium">Settings › Integrations</span> and the
          tip prompt will start appearing on your invoices.
        </div>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <span>
          <span className="block text-sm font-medium">
            Let clients add a tip when they pay
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Adds an optional tip to the card-payment page on your invoices.
            &ldquo;No tip&rdquo; is always offered, and the amount goes to the
            cleaner who did the work &mdash; we take nothing from it.
          </span>
        </span>
      </label>

      {enabled && (
        <div>
          <p className="text-xs font-medium">Suggested amounts</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Percentages of the invoice balance. Pick up to {MAX_CHOSEN} &mdash;
            clients can also enter their own.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_CHOICES.map((p) => {
              const on = presets.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className={[
                    "rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted/60",
                  ].join(" ")}
                >
                  {p}%
                </button>
              );
            })}
          </div>
          {presets.map((p) => (
            <input key={p} type="hidden" name="presets" value={p} />
          ))}
        </div>
      )}

      <SubmitButton>Save</SubmitButton>
    </form>
  );
}
