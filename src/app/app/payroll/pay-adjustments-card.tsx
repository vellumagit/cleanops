"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrencyCents, type CurrencyCode } from "@/lib/format";
import { createPayAdjustmentAction, deletePayAdjustmentAction } from "./adjustment-actions";

export type WaitingAdjustment = {
  id: string;
  employeeName: string;
  amountCents: number;
  reason: string;
  corrects: string | null;
};

/**
 * Pay adjustments on the Payroll page: the way to put pay right after a
 * period has been paid and locked. Lists the ones waiting for the next pay
 * period and adds a new one.
 */
export function PayAdjustmentsCard({
  employees,
  waiting,
  currency,
}: {
  employees: Array<{ id: string; name: string }>;
  waiting: WaitingAdjustment[];
  currency: CurrencyCode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createPayAdjustmentAction(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Adjustment saved. It goes on the next pay period you prepare.");
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const res = await deletePayAdjustmentAction(fd);
      if (!res.ok) toast.error(res.error);
      else toast.success("Adjustment removed");
      router.refresh();
    });
  }

  return (
    <section id="adjustments" className="scroll-mt-24 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-muted-foreground" />
            Pay adjustments
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            For a mistake found after a pay period was paid. A paid period stays locked, so
            the correction is an amount for one person, plus or minus, that goes on the next
            pay period you prepare as its own line with your note.
          </p>
        </div>
        {!open && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Add an adjustment
          </Button>
        )}
      </div>

      {waiting.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border" data-testid="waiting-adjustments">
          {waiting.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {a.employeeName}{" "}
                  <span
                    className={
                      a.amountCents < 0
                        ? "font-mono tabular-nums text-destructive"
                        : "font-mono tabular-nums text-emerald-700 dark:text-emerald-400"
                    }
                  >
                    {a.amountCents < 0 ? "−" : "+"}
                    {formatCurrencyCents(Math.abs(a.amountCents), currency)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {a.reason}
                  {a.corrects ? ` · corrects ${a.corrects}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Waiting for the next pay period
              </span>
              <button
                type="button"
                onClick={() => remove(a.id)}
                disabled={pending}
                aria-label={`Remove the adjustment for ${a.employeeName}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <form ref={formRef} action={submit} className="mt-4 space-y-4 rounded-md border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="adj_employee">Who</Label>
              <select
                id="adj_employee"
                name="employee_id"
                required
                defaultValue=""
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Pick an employee…
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj_amount">Amount</Label>
              <Input id="adj_amount" name="amount" inputMode="decimal" placeholder="30.00" required />
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">This adjustment</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="direction" value="add" defaultChecked className="h-4 w-4" />
              Pays them more (they were underpaid)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="direction" value="take_back" className="h-4 w-4" />
              Takes it back (they were overpaid)
            </label>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="adj_reason">What it corrects</Label>
            <Input
              id="adj_reason"
              name="reason"
              required
              maxLength={500}
              placeholder="e.g. Nov 12 shift was 4 hours, paid as 2"
            />
            <p className="text-[11px] text-muted-foreground">Printed on their pay statement.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="adj_from">Period it corrects, from (optional)</Label>
              <Input id="adj_from" name="corrects_period_start" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj_to">to</Label>
              <Input id="adj_to" name="corrects_period_end" type="date" />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            A pay period you have already prepared won&rsquo;t include this. If it should, delete
            that period (while it is unpaid) and prepare it again.
          </p>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save adjustment"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
