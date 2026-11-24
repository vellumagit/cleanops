"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { STEP_CHOICES, SUGGESTED_HOURS, WEEKDAYS } from "@/lib/open-time-rules";
import type { Hours, OpenTimeRules } from "@/lib/open-times";
import { saveOpenTimeRulesAction, type OnlineBookingState } from "./actions";
import { keepFormOnSave } from "@/lib/keep-form-on-save";

const empty: OnlineBookingState = {};

/**
 * When the company can be booked online, and by whom. Feeds the preview
 * underneath; nothing here is shown to the public yet.
 *
 * One stretch of hours per weekday. A page that has never had hours saved
 * is offered weekdays nine to five to start from, and says it isn't saved.
 */
export function OpenTimesForm({
  rules,
  people,
  timeBooking,
  changeNoticeHours,
}: {
  /** Hours before a visit up to which a client can change or cancel it themselves. */
  changeNoticeHours: number;
  /** Whether a visitor can pick a time, and whether the office confirms it. */
  timeBooking: "off" | "approve" | "instant";
  rules: OpenTimeRules;
  people: Array<{ id: string; name: string; role: string; takes: boolean }>;
}) {
  const [state, save] = useActionState(saveOpenTimeRulesAction, empty);
  const neverSet = Object.keys(rules.openingHours).length === 0;
  const start: Record<number, Hours[]> = neverSet ? SUGGESTED_HOURS : rules.openingHours;
  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(WEEKDAYS.map(({ day }) => [day, (start[day]?.length ?? 0) > 0])),
  );
  const ticked = people.filter((p) => p.takes).length;

  return (
    <form onReset={keepFormOnSave} action={save} className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold">When you can be booked</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          These decide which times are open. Use the preview below to see what a visitor would be offered before
          you let anyone pick one.
        </p>
      </div>
      <FormError message={state.error} />
      {state.ok && (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {state.ok}
        </p>
      )}
      {neverSet && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          No hours are saved yet, so you are closed every day. Weekdays nine to five are filled in below as a start;
          change them and press Save.
        </p>
      )}

      <FormField
        label="Can a visitor pick a time?"
        htmlFor="time_booking"
        hint="Off: your page takes requests only. The other two add a Book a clean button to your page."
      >
        <FormSelect id="time_booking" name="time_booking" defaultValue={timeBooking}>
          <option value="off">No, requests only</option>
          <option value="approve">Yes, and I confirm each one (the time is held until I do)</option>
          <option value="instant">Yes, booked straight away</option>
        </FormSelect>
      </FormField>

      <fieldset>
        <legend className="text-sm font-medium">Opening hours</legend>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {WEEKDAYS.map(({ day, label }) => {
            const block = start[day]?.[0];
            return (
              <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2.5 text-sm font-medium">
                  <input
                    type="checkbox"
                    name={`open_${day}`}
                    checked={open[day] ?? false}
                    onChange={(e) => setOpen((o) => ({ ...o, [day]: e.target.checked }))}
                    className="h-4 w-4 rounded border-input"
                  />
                  {label}
                </label>
                {open[day] ? (
                  <div className="flex items-center gap-2">
                    <Input type="time" name={`start_${day}`} defaultValue={block?.start ?? "09:00"} aria-label={`${label} opens`} className="w-32" />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input type="time" name={`end_${day}`} defaultValue={block?.end ?? "17:00"} aria-label={`${label} closes`} className="w-32" />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Notice you need" htmlFor="min_notice_hours" hint="Hours. 24 means nobody can book for sooner than this time tomorrow.">
          <Input id="min_notice_hours" name="min_notice_hours" inputMode="numeric" defaultValue={String(rules.minNoticeHours)} />
        </FormField>
        <FormField label="How far ahead" htmlFor="max_days_ahead" hint="Days. 60 means up to two months out.">
          <Input id="max_days_ahead" name="max_days_ahead" inputMode="numeric" defaultValue={String(rules.maxDaysAhead)} />
        </FormField>
        <FormField label="Gap between jobs" htmlFor="gap_minutes" hint="Minutes kept clear before and after a cleaner's other jobs, for travel.">
          <Input id="gap_minutes" name="gap_minutes" inputMode="numeric" defaultValue={String(rules.gapMinutes)} />
        </FormField>
        <FormField
          label="Changes and cancellations"
          htmlFor="change_notice_hours"
          hint="Hours. Up to this long before a visit, a client can cancel it themselves, or move it if visitors can book straight away. Closer than this, cancelling asks you first."
        >
          <Input id="change_notice_hours" name="change_notice_hours" inputMode="numeric" defaultValue={String(changeNoticeHours)} />
        </FormField>
        <FormField label="Start times every" htmlFor="slot_step_minutes">
          <FormSelect id="slot_step_minutes" name="slot_step_minutes" defaultValue={String(rules.stepMinutes)}>
            {STEP_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? "Hour" : `${m} minutes`}
              </option>
            ))}
          </FormSelect>
        </FormField>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Who takes online bookings</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only the people you tick are offered. A time is open when enough of them are free: not on time off, inside
          the hours they gave, and not on another job.
        </p>
        {people.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">You have no active team members yet.</p>
        ) : (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {people.map((p) => (
              <li key={p.id}>
                <input type="hidden" name={`cleaner_listed_${p.id}`} value="1" />
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" name="takes" value={p.id} defaultChecked={p.takes} className="h-4 w-4 rounded border-input" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{p.name}</span>
                  {p.role !== "employee" && <span className="text-xs text-muted-foreground">{p.role}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {people.length > 0 && ticked === 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Nobody is ticked yet, so no time is open.</p>
        )}
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save hours and people</SubmitButton>
      </div>
    </form>
  );
}
