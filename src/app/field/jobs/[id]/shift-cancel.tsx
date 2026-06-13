"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelShiftAction, requestSeriesStopAction } from "../actions";

/**
 * "Can't make this shift?" control for a shift the cleaner already accepted.
 * Requires a reason. For recurring jobs it also offers cancelling this one
 * AND requesting to be taken off the standing client going forward.
 */
export function ShiftCancel({
  bookingId,
  isRecurring,
}: {
  bookingId: string;
  isRecurring: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= 3;

  function run(kind: "single" | "series") {
    if (!reasonOk) {
      toast.error("Please add a short reason.");
      return;
    }
    startTransition(async () => {
      const res =
        kind === "series"
          ? await requestSeriesStopAction(bookingId, reason.trim())
          : await cancelShiftAction(bookingId, reason.trim());
      if (res.ok) {
        toast.success(
          kind === "series"
            ? "Shift cancelled and request sent to your manager"
            : "Shift cancelled — your manager has been notified",
        );
        router.push("/field/jobs");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <CalendarX className="h-4 w-4" />
        Can&rsquo;t make this shift?
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Cancel this shift</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Your manager will be notified so they can cover it. A reason is
        required.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="Why can't you make it? (e.g. sick, car trouble)"
        className="mt-3 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <div className="mt-3 flex flex-col gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => run("single")}
          disabled={isPending || !reasonOk}
        >
          {isPending ? "Cancelling…" : "Cancel just this shift"}
        </Button>
        {isRecurring && (
          <Button
            type="button"
            variant="outline"
            onClick={() => run("series")}
            disabled={isPending || !reasonOk}
          >
            {isPending
              ? "Sending…"
              : "Cancel this + ask to stop the recurring client"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          disabled={isPending}
        >
          Never mind
        </Button>
      </div>
      {isRecurring && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Requesting to stop the recurring client cancels this visit now;
          your upcoming visits stay on your schedule until your manager
          reassigns them.
        </p>
      )}
    </div>
  );
}
