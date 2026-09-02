"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
} from "@/components/status-badge";
import { setBookingStatusAction } from "./actions";
import {
  rendersAsStaticBadge,
  statusDropdownOptions,
} from "@/lib/booking-status";

export function BookingStatusDropdown({
  bookingId,
  status,
  canEdit,
  scheduledAt,
}: {
  bookingId: string;
  status: string;
  canEdit: boolean;
  /** When the job is scheduled. A future-dated booking can be moved back to
   *  any pre-work status; a past one keeps the strict forward ladder. */
  scheduledAt?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

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

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    if (target === status) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", bookingId);
      fd.set("status", target);
      const res = await setBookingStatusAction(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't update status.");
      } else {
        toast.success("Status updated.");
      }
      router.refresh();
    });
  }

  return (
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
  );
}
