"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BookingWarning } from "@/app/app/bookings/booking-warnings";

/**
 * The bookings list has room for labelled warning chips. A scheduler card in a
 * 7-column week grid does not — so the same signal shows up here as a single
 * dot with the detail on hover: enough to say "look at this one" without
 * making the owner open every card to find the one job that needs attention.
 *
 * Delivered by context rather than props because the card sits three levels
 * below the grid (grid → cell → draggable → card) and none of the layers in
 * between have any business knowing about warnings.
 */

type WarningLookup = (bookingId: string) => BookingWarning[] | undefined;

const WarningContext = createContext<WarningLookup>(() => undefined);

export function WarningProvider({
  /** The shell computes warnings once for the whole week; accept either
   *  shape so a Map from a client component and a plain object serialized
   *  from the server both work. */
  warnings,
  children,
}: {
  warnings?: Record<string, BookingWarning[]> | Map<string, BookingWarning[]>;
  children: ReactNode;
}) {
  const lookup: WarningLookup = (id) => {
    if (!warnings) return undefined;
    return warnings instanceof Map ? warnings.get(id) : warnings[id];
  };

  return (
    <WarningContext.Provider value={lookup}>{children}</WarningContext.Provider>
  );
}

/**
 * The warnings for one booking, for surfaces with room to spell them out.
 *
 * The dot's explanation lives in a `title` tooltip, which never fires on a
 * touch device — on a phone the owner sees a red dot and has no way to learn
 * what it means. Anything inside the grid can read the same context and say it
 * properly.
 */
export function useBookingWarnings(
  bookingId: string | null | undefined,
): BookingWarning[] {
  const lookup = useContext(WarningContext);
  if (!bookingId) return [];
  return lookup(bookingId) ?? [];
}

export function WarningDot({ bookingId }: { bookingId: string }) {
  const lookup = useContext(WarningContext);
  const warnings = lookup(bookingId);
  if (!warnings || warnings.length === 0) return null;
  const high = warnings.some((w) => w.severity === "high");
  return (
    <span
      title={warnings.map((w) => `${w.label}: ${w.detail}`).join("\n\n")}
      aria-label={warnings.map((w) => w.label).join(", ")}
      className={cn(
        "inline-flex h-2 w-2 shrink-0 rounded-full",
        high ? "bg-red-500" : "bg-amber-500",
      )}
    />
  );
}
