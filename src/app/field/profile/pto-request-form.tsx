"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertCircle, Loader2, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { submitSelfPtoRequestAction } from "@/app/app/timesheets/actions";

type Result = { ok: true } | { ok: false; error: string } | null;

export function PtoRequestForm() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>(null);

  function onSubmit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const r = await submitSelfPtoRequestAction(formData);
      setResult(r);
      if (r.ok) {
        // Clear the form by forcing a re-mount
        setTimeout(() => setResult(null), 4000);
        const form = document.getElementById("pto-form") as HTMLFormElement | null;
        form?.reset();
      }
    });
  }

  return (
    <form id="pto-form" action={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="start_date" className="mb-1 block text-xs font-medium">
            Start date
          </label>
          <Input
            id="start_date"
            name="start_date"
            type="date"
            required
            disabled={isPending}
          />
        </div>
        <div>
          <label htmlFor="end_date" className="mb-1 block text-xs font-medium">
            End date
          </label>
          <Input
            id="end_date"
            name="end_date"
            type="date"
            required
            disabled={isPending}
          />
        </div>
      </div>

      <div>
        <label htmlFor="hours" className="mb-1 block text-xs font-medium">
          Hours requested
        </label>
        <Input
          id="hours"
          name="hours"
          type="number"
          min={1}
          max={200}
          step={0.5}
          defaultValue={8}
          required
          disabled={isPending}
        />
      </div>

      <div>
        <label htmlFor="reason" className="mb-1 block text-xs font-medium">
          Reason (optional)
        </label>
        <Textarea
          id="reason"
          name="reason"
          rows={2}
          placeholder="e.g. family vacation, doctor's appointment"
          disabled={isPending}
        />
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          <>
            <Calendar className="mr-1.5 h-4 w-4" />
            Request time off
          </>
        )}
      </Button>

      {result?.ok && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Request submitted. Your manager will review it soon.</span>
        </div>
      )}
      {result && !result.ok && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{result.error}</span>
        </div>
      )}
    </form>
  );
}
