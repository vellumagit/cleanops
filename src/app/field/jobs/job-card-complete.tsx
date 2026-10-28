"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { tap, type TapKind } from "../tap";

/**
 * "I'm here" / "I'm done" on a job card — the Today list and the clock
 * screen — so a cleaner never has to open the job to say either.
 *
 * "I'm done" takes two taps: the card behind it is a navigation target, and
 * a mis-tap stops her clock and can finish the job. The confirm resets
 * itself after 4s so a stray first tap doesn't arm indefinitely. "I'm here"
 * is one tap — the worst a wrong one does is start a clock she can stop.
 */
export function JobCardTap({
  bookingId,
  kind,
  size = "compact",
}: {
  bookingId: string;
  kind: TapKind;
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
    e.preventDefault();
    e.stopPropagation();

    if (kind === "done" && !armed) {
      setArmed(true);
      return;
    }

    startTransition(async () => {
      const outcome = await tap(kind, bookingId);
      setArmed(false);
      if (outcome.status === "sent") {
        toast.success(kind === "here" ? "You're here — clock started" : "Done — clock stopped");
        router.refresh();
      } else if (outcome.status === "queued") {
        toast.warning("No signal. Saved with the time you tapped — it'll send when you're back in range.");
        router.refresh();
      } else {
        toast.error(outcome.error);
      }
    });
  }

  const shape =
    size === "full"
      ? "h-14 w-full justify-center text-base"
      : "h-11 shrink-0 px-4 text-sm";
  const tone =
    kind === "here"
      ? "bg-foreground text-background"
      : armed
        ? "bg-emerald-600 text-white"
        : "border border-emerald-600 bg-background text-emerald-700 dark:text-emerald-400";
  const Icon = kind === "here" ? MapPin : CheckCircle2;

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
      <Icon className={size === "full" ? "h-5 w-5" : "h-4 w-4"} />
      {isPending
        ? "One moment…"
        : kind === "here"
          ? "I'm here"
          : armed
            ? "Tap to confirm"
            : "I'm done"}
    </button>
  );
}

/** Kept for the clock screen's import; same component, "done" kind. */
export function JobCardComplete(props: { bookingId: string; size?: "compact" | "full" }) {
  return <JobCardTap kind="done" {...props} />;
}
