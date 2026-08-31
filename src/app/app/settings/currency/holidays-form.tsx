"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import type { RegionOptions } from "@/lib/holidays";
import {
  saveHolidayRegionAction,
  type HolidayRegionFormState,
} from "./actions";

const empty: HolidayRegionFormState = {};

/**
 * Country (+ optional province/state) picker for statutory holidays.
 * The subdivision list swaps with the chosen country — some countries
 * (most, actually) vary their holidays by region, and Alberta's Family
 * Day is exactly why the second select exists.
 */
export function HolidaysForm({
  current,
  options,
}: {
  /** "CA-AB", "CA", or null (off). */
  current: string | null;
  options: RegionOptions;
}) {
  const [state, formAction] = useActionState(saveHolidayRegionAction, empty);
  const [currentCountry, currentState] = (current ?? "").split("-");
  const [country, setCountry] = useState(currentCountry ?? "");
  const states = country ? (options.states[country] ?? []) : [];

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      <FormError message={state.errors?._form} />

      {state.success && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved. The scheduler now marks that region&apos;s statutory
          holidays.
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Country"
          htmlFor="holiday_country"
          error={state.errors?.holiday_country}
        >
          <FormSelect
            id="holiday_country"
            name="holiday_country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">Off — no holidays shown</option>
            {options.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField
          label="Province / state"
          htmlFor="holiday_state"
          hint={
            states.length > 0
              ? "Regional holidays (like Alberta's Family Day) need this."
              : "This country has no regional holiday variations."
          }
        >
          <FormSelect
            id="holiday_state"
            name="holiday_state"
            key={country}
            defaultValue={country === currentCountry ? (currentState ?? "") : ""}
            disabled={states.length === 0}
          >
            <option value="">— National holidays only —</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <div className="flex items-center justify-end">
        <SubmitButton pendingLabel="Saving…">Save holiday region</SubmitButton>
      </div>
    </form>
  );
}
