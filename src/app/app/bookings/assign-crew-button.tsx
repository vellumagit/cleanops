"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AssignCrewDialog,
  type AssignableEmployee,
} from "./assign-crew-dialog";

/**
 * Self-contained Assign-crew trigger. Owns the open state so it can be
 * dropped into any surface (bookings list rows, booking detail header,
 * etc.) without the caller having to wire up `useState` boilerplate.
 *
 * The actual dialog (assign-crew-dialog.tsx) is reused — this is just a
 * thin button + state holder that points at it.
 */
export function AssignCrewButton({
  bookingId,
  employees,
  initialPrimaryId,
  initialAdditionalIds,
  /** Visual flavor — the bookings list wants a compact icon-only chip,
   *  the detail page header wants a labelled outline button. Both flow
   *  through here so the dialog wiring stays in one place. */
  variant = "outline",
  size = "sm",
  label = "Assign",
  /** Stop click bubbling — useful when the button sits inside a row that
   *  also navigates on click (bookings table row click → /edit). */
  stopPropagation = false,
}: {
  bookingId: string;
  employees: AssignableEmployee[];
  initialPrimaryId: string | null;
  initialAdditionalIds: string[];
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
  stopPropagation?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          setOpen(true);
        }}
      >
        <Users className="h-4 w-4" />
        {label}
      </Button>
      <AssignCrewDialog
        bookingId={bookingId}
        employees={employees}
        initialPrimaryId={initialPrimaryId}
        initialAdditionalIds={initialAdditionalIds}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
