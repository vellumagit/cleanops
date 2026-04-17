"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createPayrollRunAction } from "./actions";

export function NewPayrollRunForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Default: last 14 days
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 14);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r = await createPayrollRunAction(formData);
      if (r.ok) {
        router.push(`/app/payroll/${r.id}`);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="period_start" className="mb-1 block text-xs font-medium">
          Period start
        </label>
        <Input
          id="period_start"
          name="period_start"
          type="date"
          required
          defaultValue={start.toISOString().slice(0, 10)}
          disabled={isPending}
        />
      </div>
      <div>
        <label htmlFor="period_end" className="mb-1 block text-xs font-medium">
          Period end
        </label>
        <Input
          id="period_end"
          name="period_end"
          type="date"
          required
          defaultValue={now.toISOString().slice(0, 10)}
          disabled={isPending}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Sums every clocked-in hour, approved bonus, and approved PTO hour for
        active employees in this window.
      </p>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            Computing…
          </>
        ) : (
          "Create pay period"
        )}
      </Button>
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </form>
  );
}
