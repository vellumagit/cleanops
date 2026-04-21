"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/submit-button";
import { updateThresholdsAction, type ThresholdsState } from "./actions";

type Defaults = {
  stale_estimate_expire_days: number | null;
  invoice_void_days: number | null;
  booking_auto_complete_hours: number | null;
  archive_after_days: number | null;
  overtime_threshold_hours: number;
};

export function ThresholdsForm({ defaults }: { defaults: Defaults }) {
  const [state, formAction] = useActionState<ThresholdsState, FormData>(
    updateThresholdsAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      <Field
        label="Expire stale estimates after"
        name="stale_estimate_expire_days"
        suffix="days"
        min={1}
        defaultValue={defaults.stale_estimate_expire_days}
        description="An estimate in Sent status with no activity (no approval, no decline) for this many days auto-flips to Expired. Default 30."
      />
      <Field
        label="Void overdue invoices after"
        name="invoice_void_days"
        suffix="days"
        min={30}
        defaultValue={defaults.invoice_void_days}
        description="An invoice overdue for this many days with no payment activity auto-flips to Void and stops overdue reminders. Default 90."
      />
      <Field
        label="Auto-complete past bookings after"
        name="booking_auto_complete_hours"
        suffix="hours"
        min={1}
        defaultValue={defaults.booking_auto_complete_hours}
        description="A booking in Pending or Confirmed this many hours past its scheduled time auto-flips to Completed. Default 24."
      />
      <Field
        label="Auto-archive records older than"
        name="archive_after_days"
        suffix="days"
        min={180}
        defaultValue={defaults.archive_after_days}
        description="Terminal-state bookings, invoices, and estimates older than this are hidden from default list views. Default 730 (2 years). Minimum 180."
      />

      <div className="border-t border-border pt-6">
        <Field
          label="Overtime threshold"
          name="overtime_threshold_hours"
          suffix="hours / week"
          min={1}
          required
          defaultValue={defaults.overtime_threshold_hours}
          description="Employees whose week-to-date hours are within 20% of this threshold get the Friday overtime warning email. Default 40."
        />
      </div>

      {state.error && (
        <p className="text-xs text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-xs text-emerald-700">Thresholds saved.</p>
      )}

      <SubmitButton pendingLabel="Saving…">Save thresholds</SubmitButton>
    </form>
  );
}

function Field({
  label,
  name,
  suffix,
  min,
  defaultValue,
  description,
  required,
}: {
  label: string;
  name: string;
  suffix: string;
  min: number;
  defaultValue: number | null;
  description: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <div className="mt-1 flex items-center gap-3">
        <Input
          id={name}
          name={name}
          type="number"
          inputMode="numeric"
          min={min}
          step={1}
          required={required}
          placeholder={required ? undefined : "blank = disable"}
          defaultValue={defaultValue ?? ""}
          className="max-w-[160px]"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
