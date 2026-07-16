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

/**
 * Forward+cancel options the dropdown offers, keyed by current status. Terminal
 * statuses (completed, cancelled) aren't listed → they render as a static badge.
 * Mirrors STATUS_DROPDOWN_TRANSITIONS in actions.ts (plus the current status so
 * it shows as the selected option).
 */
const OPTIONS: Record<string, readonly string[]> = {
  confirmed: ["confirmed", "in_progress", "completed", "cancelled"],
  in_progress: ["in_progress", "completed", "cancelled"],
};

export function BookingStatusDropdown({
  bookingId,
  status,
  canEdit,
}: {
  bookingId: string;
  status: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const options = OPTIONS[status];
  // Read-only: no edit rights, or a terminal status → plain badge.
  if (!canEdit || !options) {
    return (
      <StatusBadge tone={bookingStatusTone(status as Parameters<typeof bookingStatusTone>[0])}>
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
