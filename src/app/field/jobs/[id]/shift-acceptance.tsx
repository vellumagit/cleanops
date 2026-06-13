"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, X, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptShiftAction, declineShiftAction } from "../actions";

/**
 * Pending-shift confirmation card shown at the top of a job the cleaner
 * hasn't responded to yet. They must Accept before they can start the job;
 * "Can't make it" removes them and alerts the office to reassign.
 */
export function ShiftAcceptance({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingDecline, setConfirmingDecline] = useState(false);

  function accept() {
    startTransition(async () => {
      const res = await acceptShiftAction(bookingId);
      if (res.ok) {
        toast.success("Shift confirmed — you're on it");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function decline() {
    startTransition(async () => {
      const res = await declineShiftAction(bookingId);
      if (res.ok) {
        toast.success("Shift declined — your manager has been notified");
        router.push("/field/jobs");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
            Confirm this shift
          </h2>
          <p className="mt-0.5 text-sm text-amber-800/80 dark:text-amber-200/70">
            You&rsquo;ve been assigned this job. Let your team know you can
            make it.
          </p>
        </div>
      </div>

      {!confirmingDecline ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="h-13 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
            onClick={accept}
            disabled={isPending}
          >
            <CheckCircle2 className="mr-2 h-5 w-5" />
            {isPending ? "Confirming…" : "Accept shift"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-11 text-sm font-medium text-amber-900/80 hover:bg-amber-100 dark:text-amber-200/80 dark:hover:bg-amber-900/30"
            onClick={() => setConfirmingDecline(true)}
            disabled={isPending}
          >
            Can&rsquo;t make it
          </Button>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-amber-300 bg-card p-3 dark:border-amber-900/50">
          <p className="text-sm font-medium">
            Decline this shift? You&rsquo;ll be removed from the job and your
            manager will be asked to reassign it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={decline}
              disabled={isPending}
            >
              <X className="mr-1.5 h-4 w-4" />
              {isPending ? "Declining…" : "Yes, decline"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmingDecline(false)}
              disabled={isPending}
            >
              Keep shift
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
