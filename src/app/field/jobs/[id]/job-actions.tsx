"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tap, type TapKind } from "../../tap";

/**
 * The only two things a cleaner says about a job: I'm here, I'm done. Both
 * are about her own shift. What they mean for the job — whether it's over,
 * who's still coming — is decided from everyone's shifts together, on the
 * server, and shown in the facts line above the button.
 */
export function JobActionButtons({
  bookingId,
  status,
  youCompleted = false,
  myOpenEntryHere = false,
  notDueYet = false,
  scheduledLabel,
  facts,
}: {
  bookingId: string;
  status: string;
  /** More than the early-start grace away: "I'm here" would be refused, so
   *  say when it unlocks instead. How a cleaner on the wrong card finds out. */
  notDueYet?: boolean;
  /** "Sep 26, 2026 · 3:00 PM" in the org's zone, for that message. */
  scheduledLabel?: string;
  /** She tapped "I'm done" but the job isn't over for everyone yet. */
  youCompleted?: boolean;
  /** She has an open shift on THIS job right now. */
  myOpenEntryHere?: boolean;
  /** "You arrived 8:59 · 3 of 4 here · Ivanna hasn't arrived" */
  facts?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);

  // "I'm done" takes two taps: it stops her pay clock and can finish the
  // job. The confirm resets itself so a stray first tap doesn't sit armed.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  function run(kind: TapKind) {
    startTransition(async () => {
      const outcome = await tap(kind, bookingId);
      setArmed(false);
      if (outcome.status === "sent") {
        toast.success(kind === "here" ? "You're here — clock started" : "Done — clock stopped");
        router.refresh();
      } else if (outcome.status === "queued") {
        toast.warning(
          "No signal. Saved on your phone with the time you tapped — it'll send when you're back in range.",
        );
        router.refresh();
      } else {
        toast.error(outcome.error);
      }
    });
  }

  const isDone = status === "completed";

  if (isDone) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-base font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="h-5 w-5" />
        Job complete. Nice work.
      </div>
    );
  }

  if (youCompleted) {
    return (
      <div className="flex flex-col gap-3">
        {facts && <Facts text={facts} />}
        <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-center text-base font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          You&rsquo;re done here. The job stays open until the rest of the
          crew is.
        </div>
        {!myOpenEntryHere ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 text-base"
            onClick={() => run("here")}
            disabled={isPending}
          >
            <Undo2 className="mr-2 h-5 w-5" />
            {isPending ? "One moment…" : "Not done? I'm back"}
          </Button>
        ) : null}
      </div>
    );
  }

  if (notDueYet && status !== "in_progress") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium">
          This job is on {scheduledLabel ?? "a later date"}.
        </p>
        <p className="mt-1 text-muted-foreground">
          &ldquo;I&rsquo;m here&rdquo; appears four hours before it begins.
          If you&rsquo;re working today, go back to Today and open the card
          dated today.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {facts && <Facts text={facts} />}
      {!myOpenEntryHere ? (
        <Button
          type="button"
          size="lg"
          className="h-16 text-lg font-semibold"
          onClick={() => run("here")}
          disabled={isPending}
        >
          <MapPin className="mr-2 h-6 w-6" />
          {isPending ? "One moment…" : "I'm here"}
        </Button>
      ) : (
        <Button
          type="button"
          size="lg"
          className={
            armed
              ? "h-16 bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-600"
              : "h-16 text-lg font-semibold"
          }
          onClick={() => (armed ? run("done") : setArmed(true))}
          disabled={isPending}
        >
          <CheckCircle2 className="mr-2 h-6 w-6" />
          {isPending ? "One moment…" : armed ? "Tap again — I'm done" : "I'm done"}
        </Button>
      )}
    </div>
  );
}

function Facts({ text }: { text: string }) {
  return (
    <p className="text-center text-sm font-medium text-muted-foreground">
      {text}
    </p>
  );
}
