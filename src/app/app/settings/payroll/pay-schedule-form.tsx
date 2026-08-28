"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-field";
import {
  PAY_SCHEDULE_LABELS,
  type PaySchedule,
} from "@/lib/pay-schedule";
import { updatePayScheduleAction } from "@/app/app/payroll/actions";

/**
 * The pay-period calendar, edited where settings live. Started life as a
 * dialog on the Payroll page; Brian: "move that setting to the settings
 * page ... consolidate everything that has to do with that." Same action
 * underneath — only the address changed.
 */
export function PayScheduleForm({
  schedule,
  anchor,
}: {
  schedule: PaySchedule | null;
  anchor: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string>(schedule ?? "");
  const [anchorValue, setAnchorValue] = useState<string>(anchor ?? "");
  const [error, setError] = useState<string | null>(null);

  const needsAnchor = value === "weekly" || value === "biweekly";

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("pay_schedule", value);
    fd.set("pay_anchor", anchorValue);
    startTransition(async () => {
      const r = await updatePayScheduleAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(
        value === "" ? "Pay schedule cleared" : "Pay schedule saved",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="pay_schedule" className="text-xs font-medium">
            Cadence
          </label>
          <FormSelect
            id="pay_schedule"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">Manual — I&rsquo;ll pick dates each time</option>
            <option value="semimonthly">
              {PAY_SCHEDULE_LABELS.semimonthly}
            </option>
            <option value="biweekly">{PAY_SCHEDULE_LABELS.biweekly}</option>
            <option value="weekly">{PAY_SCHEDULE_LABELS.weekly}</option>
            <option value="monthly">{PAY_SCHEDULE_LABELS.monthly}</option>
          </FormSelect>
        </div>

        {needsAnchor && (
          <div className="space-y-1.5">
            <label htmlFor="pay_anchor" className="text-xs font-medium">
              A date a pay period started
            </label>
            <Input
              id="pay_anchor"
              type="date"
              value={anchorValue}
              onChange={(e) => setAnchorValue(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Cycles are counted in exact {value === "weekly" ? "7" : "14"}-day
              steps from this date.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs font-medium text-destructive">{error}</p>
      )}

      <Button type="button" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save schedule"}
      </Button>
    </div>
  );
}
