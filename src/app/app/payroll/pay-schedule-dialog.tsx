"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-field";
import {
  PAY_SCHEDULE_LABELS,
  type PaySchedule,
} from "@/lib/pay-schedule";
import { updatePayScheduleAction } from "./actions";

/**
 * One quiet row under the Up-next card: what calendar pay periods follow,
 * and the dialog to change it. Semi-monthly and monthly need nothing else;
 * weekly/biweekly ask for one anchor date (any real period start) that
 * cycles are counted from.
 */
export function PayScheduleDialog({
  schedule,
  anchor,
}: {
  schedule: PaySchedule | null;
  anchor: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        {schedule ? (
          <>
            Periods follow:{" "}
            <span className="font-medium text-foreground">
              {PAY_SCHEDULE_LABELS[schedule]}
            </span>
          </>
        ) : (
          "Set a pay schedule — stop picking dates by hand"
        )}
        <span className="underline underline-offset-2">Change</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay schedule</DialogTitle>
            <DialogDescription>
              The Up-next card will suggest periods on this calendar. Runs are
              still created and paid by you — this only decides the dates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
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
                  Cycles are counted in exact{" "}
                  {value === "weekly" ? "7" : "14"}-day steps from this date.
                </p>
              </div>
            )}

            {error && (
              <p className="text-xs font-medium text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
