"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { completeJobAction } from "./actions";

/**
 * "End job" for a job already in progress — on the jobs list card, and on the
 * clock screen when the open shift belongs to a booking.
 *
 * Cleaners were having to open the job to finish it, while a separate Clock
 * out sat on another screen — two routes to "I'm done" and neither where you
 * are. Worse, the two aren't equivalent: clocking out stops the clock but
 * leaves the booking in progress forever. This puts the one that actually
 * finishes the job wherever the cleaner already is.
 *
 * Two taps, deliberately: the whole card is a navigation target, and a
 * mis-tap here clocks someone out and can draft an invoice. The confirm
 * step resets itself after 4s so a stray first tap doesn't arm indefinitely.
 */
export function JobCardComplete({
  bookingId,
  size = "compact",
}: {
  bookingId: string;
  /** "full" for the clock screen, where this is the whole point of the page. */
  size?: "compact" | "full";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  function handleClick(e: React.MouseEvent) {
    // The card behind this is a full-bleed link — never navigate on a tap
    // aimed at the button.
    e.preventDefault();
    e.stopPropagation();

    if (!armed) {
      setArmed(true);
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      fd.set("booking_id", bookingId);
      // Location is captured on the job page where permission has usually
      // been granted; skipping it here keeps the list tap instant.
      const result = await completeJobAction(fd);
      if (result.ok) {
        toast.success("Job complete — clocked out");
        router.refresh();
      } else {
        toast.error(result.error);
        setArmed(false);
      }
    });
  }

  const shape =
    size === "full"
      ? "h-14 w-full justify-center text-base"
      : "h-11 shrink-0 px-4 text-sm";
  const tone = armed
    ? "bg-emerald-600 text-white"
    : "border border-emerald-600 bg-background text-emerald-700 dark:text-emerald-400";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        "relative z-10 inline-flex items-center gap-1.5 rounded-lg font-semibold active:scale-95 disabled:opacity-60",
        shape,
        tone,
      )}
    >
      <CheckCircle2 className={size === "full" ? "h-5 w-5" : "h-4 w-4"} />
      {isPending ? "Ending…" : armed ? "Tap to confirm" : "End job"}
    </button>
  );
}
