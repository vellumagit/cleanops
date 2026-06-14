"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Thermometer, CalendarX, Repeat, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  cancelShiftAction,
  requestSeriesStopAction,
  callInSickAction,
} from "../actions";

type Mode = null | "sick" | "cancel" | "series";

/**
 * "Manage shift" hub on the job detail. One predictable place for the
 * lifecycle actions a cleaner takes on a shift they've accepted: call in
 * sick, cancel this shift (reason required), or — for recurring jobs — ask
 * to be taken off the standing client going forward.
 */
export function ManageShift({
  bookingId,
  isRecurring,
}: {
  bookingId: string;
  isRecurring: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= 3;

  function done(message: string) {
    toast.success(message);
    router.push("/field/jobs");
    router.refresh();
  }

  function sick() {
    startTransition(async () => {
      const res = await callInSickAction(bookingId);
      if (res.ok) done("Called in sick — your manager has been notified");
      else toast.error(res.error);
    });
  }

  function cancel(kind: "cancel" | "series") {
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
        done(
          kind === "series"
            ? "Shift cancelled and request sent to your manager"
            : "Shift cancelled — your manager has been notified",
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  function reset() {
    setMode(null);
    setReason("");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Manage shift
      </h2>

      {mode === null && (
        <div className="mt-3 divide-y divide-border">
          <Row
            icon={<Thermometer className="h-5 w-5 text-amber-600" />}
            label="Call in sick"
            sub="Cancels this shift and alerts your manager"
            onClick={() => setMode("sick")}
          />
          <Row
            icon={<CalendarX className="h-5 w-5 text-muted-foreground" />}
            label="Can't make this shift"
            sub="Give a reason — your manager covers it"
            onClick={() => setMode("cancel")}
          />
          {isRecurring && (
            <Row
              icon={<Repeat className="h-5 w-5 text-muted-foreground" />}
              label="Ask to stop the recurring client"
              sub="Cancel this visit + request off going forward"
              onClick={() => setMode("series")}
            />
          )}
        </div>
      )}

      {mode === "sick" && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            Call in sick for this shift? It&rsquo;ll be cancelled and your
            manager notified so they can cover it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={sick}
              disabled={isPending}
            >
              {isPending ? "Sending…" : "Yes, I'm sick"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={reset}
              disabled={isPending}
            >
              Back
            </Button>
          </div>
        </div>
      )}

      {(mode === "cancel" || mode === "series") && (
        <div className="mt-3">
          <p className="text-sm font-medium">
            {mode === "series"
              ? "Cancel this visit and ask to be taken off this recurring client?"
              : "Cancel this shift?"}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason (required)"
            className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {mode === "series" && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Your upcoming visits stay on your schedule until your manager
              reassigns them.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={() => cancel(mode === "series" ? "series" : "cancel")}
              disabled={isPending || !reasonOk}
            >
              {isPending
                ? "Sending…"
                : mode === "series"
                  ? "Cancel + send request"
                  : "Cancel this shift"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={reset}
              disabled={isPending}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full touch-manipulation items-center gap-3 py-3 text-left transition-transform active:scale-[0.99]"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
