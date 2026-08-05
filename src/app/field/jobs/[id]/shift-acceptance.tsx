"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, X, Clock as ClockIcon, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptShiftAction, declineShiftAction } from "../actions";

/**
 * The whole decision on one screen: when, where, and the button.
 *
 * This card used to render at the very bottom of the job page — below the
 * crew list, the photo grid and the checklist — even though its own docstring
 * claimed it sat at the top. So a cleaner opening a shift they had not yet
 * accepted scrolled past an empty photo section and a checklist for work that
 * had not happened, to reach the only control that mattered.
 *
 * It now carries the date, time and address itself rather than relying on the
 * detail card below it. Answering "when is it and where is it" is the entire
 * substance of deciding whether you can make it, and it should not cost a
 * scroll on a phone held one-handed in a doorway.
 */
export function ShiftAcceptance({
  bookingId,
  whenLabel,
  durationLabel,
  address,
}: {
  bookingId: string;
  /** Already formatted in the org's timezone by the server component. */
  whenLabel: string;
  durationLabel: string;
  address: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  // Flip the card the instant the server says yes, rather than waiting for
  // router.refresh() to re-run every query on the page behind it.
  const [accepted, setAccepted] = useState(false);

  function accept() {
    startTransition(async () => {
      const res = await acceptShiftAction(bookingId);
      if (res.ok) {
        setAccepted(true);
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

  if (accepted) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
            You&rsquo;re on it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
      <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
        Can you make this shift?
      </h2>

      {/* When and where, before the buttons — this is the decision. */}
      <dl className="mt-3 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug text-amber-950 dark:text-amber-100">
              {whenLabel}
            </div>
            <div className="text-sm text-amber-800/80 dark:text-amber-200/70">
              {durationLabel}
            </div>
          </div>
        </div>
        {address ? (
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="min-w-0 text-[15px] font-semibold leading-snug text-amber-950 dark:text-amber-100">
              {address}
            </div>
          </div>
        ) : null}
      </dl>

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
