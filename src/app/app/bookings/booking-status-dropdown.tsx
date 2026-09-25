"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
} from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setBookingStatusAction, setSeriesStatusAction } from "./actions";
import {
  rendersAsStaticBadge,
  statusDropdownOptions,
} from "@/lib/booking-status";

export function BookingStatusDropdown({
  bookingId,
  status,
  canEdit,
  scheduledAt,
  seriesId,
}: {
  bookingId: string;
  status: string;
  canEdit: boolean;
  /** When the job is scheduled. A future-dated booking can be moved back to
   *  any pre-work status; a past one keeps the strict forward ladder. */
  scheduledAt?: string | null;
  /** When set, changing the status asks whether it applies to the rest of the
   *  series. Omitted for one-off bookings, which have nothing to ask about. */
  seriesId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The status the operator picked, held while we ask how far it reaches.
  const [askScopeFor, setAskScopeFor] = useState<string | null>(null);

  const options = statusDropdownOptions(status, scheduledAt);
  // Read-only: no edit rights, or a terminal status → plain badge.
  if (rendersAsStaticBadge(status, canEdit, scheduledAt)) {
    return (
      <StatusBadge
        tone={bookingStatusTone(
          status as Parameters<typeof bookingStatusTone>[0],
        )}
      >
        {formatBookingStatus(status)}
      </StatusBadge>
    );
  }

  function applyToThisOnly(target: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bookingId);
      fd.set("status", target);
      const res = await setBookingStatusAction(fd);
      if (!res.ok) toast.error(res.error ?? "Couldn't update status.");
      else toast.success("Status updated.");
      setAskScopeFor(null);
      router.refresh();
    });
  }

  function applyToSeries(target: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bookingId);
      fd.set("status", target);
      const res = await setSeriesStatusAction(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't update the series.");
      } else {
        const n = res.changed ?? 0;
        const skipped = res.skipped ?? [];
        // Partial success is normal here — a completed visit with a live
        // invoice refuses on purpose. Say so rather than claiming a clean run.
        toast.success(
          `${n} ${n === 1 ? "visit is" : "visits are"} now ${formatBookingStatus(target).toLowerCase()}.`,
          skipped.length
            ? {
                description: `${skipped.length} left unchanged — ${skipped[0].reason}`,
                duration: 8000,
              }
            : undefined,
        );
      }
      setAskScopeFor(null);
      router.refresh();
    });
  }

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    if (target === status) return;
    // A one-off booking has no series to spread to — don't make every status
    // change a two-step for the majority of bookings.
    if (!seriesId) {
      applyToThisOnly(target);
      return;
    }
    setAskScopeFor(target);
  }

  return (
    <>
      <select
        value={status}
        onChange={onChange}
        disabled={pending}
        // The row is clickable — don't let opening/changing the dropdown navigate.
        onClick={(e) => e.stopPropagation()}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        aria-label="Booking status"
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {formatBookingStatus(s)}
          </option>
        ))}
      </select>

      <Dialog
        open={askScopeFor !== null}
        onOpenChange={(o) => {
          if (!o) setAskScopeFor(null);
        }}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              How far does &ldquo;
              {askScopeFor ? formatBookingStatus(askScopeFor) : ""}&rdquo; go?
            </DialogTitle>
            <DialogDescription>
              This is a recurring booking. The change can stop at this visit,
              or carry through every later one in the series.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => askScopeFor && applyToThisOnly(askScopeFor)}
            >
              This visit only
            </Button>
            <Button
              disabled={pending}
              onClick={() => askScopeFor && applyToSeries(askScopeFor)}
            >
              This and all future visits
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
