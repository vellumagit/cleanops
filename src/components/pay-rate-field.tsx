"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The pay rate box, on every screen that can change one.
 *
 * A shift freezes the rate at clock-in, so a new rate used to reach only
 * shifts worked after the save (src/lib/pay-rate-change.ts). Once the number
 * in the box differs from the saved one this asks when it starts: from now,
 * or from a date, in which case unpaid shifts from that date are re-priced.
 * A lower rate has to be ticked on purpose: on 2026-10-24 someone's rate
 * went from $18 to $17 with nothing asking, and three weeks of shifts were
 * worked at it before anyone noticed.
 *
 * Fields posted: pay_rate, pay_rate_from_mode ("now" or "date"),
 * pay_rate_from (YYYY-MM-DD when the mode is "date"),
 * pay_rate_lower_ok ("1" when ticked). Read by updateMemberAction.
 */
export function PayRateField({
  id,
  initialCents,
  error,
}: {
  id: string;
  initialCents: number | null;
  error?: string;
}) {
  const initial = initialCents != null ? (initialCents / 100).toFixed(2) : "";
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<"now" | "date">("now");
  const [from, setFrom] = useState("");

  const cents = parseCents(value);
  const changed = cents !== initialCents;
  const lower = changed && cents != null && initialCents != null && cents < initialCents;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        Pay rate <span className="font-normal text-muted-foreground">($/hr)</span>
      </Label>
      <Input
        id={id}
        name="pay_rate"
        type="text"
        inputMode="decimal"
        placeholder="22.00"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}

      {changed && cents != null && (
        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">When does the new rate start?</p>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            <span>
              From now
              <span className="block text-xs text-muted-foreground">
                Shifts already worked keep the old rate.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "date"}
              onChange={() => setMode("date")}
            />
            <span>
              From a date
              <span className="block text-xs text-muted-foreground">
                Unpaid shifts from that day on are re-priced. Shifts already on a pay run are not changed.
              </span>
            </span>
          </label>
          {mode === "date" && (
            <Input
              type="date"
              aria-label="New rate starts from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-auto"
            />
          )}
          {/* The server decides what "today" is, in the company's time zone,
              and refuses a future date. */}
          <input type="hidden" name="pay_rate_from_mode" value={mode} />
          <input type="hidden" name="pay_rate_from" value={mode === "date" ? from : ""} />

          {lower && (
            <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
              <input type="checkbox" name="pay_rate_lower_ok" value="1" className="mt-1" />
              <span>
                Yes, lower the rate from ${initial} to ${(cents / 100).toFixed(2)}.
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** The same reading of the box as the server's (employees/actions.ts). */
function parseCents(s: string): number | null {
  if (!s || s.trim() === "") return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
