"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  deleteBookingAction,
  skipBookingOccurrenceAction,
  type BookingRemoveRefusal,
} from "../../actions";

export function DeleteBookingForm({
  id,
  seriesId,
  scheduledAt,
  isPast,
}: {
  id: string;
  seriesId: string | null;
  scheduledAt: string;
  /** Computed on the server — past visits are undeletable (see below). */
  isPast: boolean;
}) {
  const [cascade, setCascade] = useState(false);
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<BookingRemoveRefusal | null>(null);
  const isRecurring = Boolean(seriesId);
  const occurrenceDate = new Date(scheduledAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // A refusal is shown right here and brought into view. It used to come
  // back as a redirect to this same page, which reloaded it at the top with
  // the explanation down in the danger zone: the button seemed to do nothing.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (refusal) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [refusal]);

  function fd() {
    const f = new FormData();
    f.set("id", id);
    return f;
  }

  function remove() {
    const msg = cascade
      ? "Delete this booking and every FUTURE occurrence in the series? Past visits are kept. This cannot be undone."
      : isPast
        ? "Delete this PAST visit? It disappears from records and reports; hours logged on it stay in Timesheets. This cannot be undone."
        : "Delete this booking? This cannot be undone.";
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      const f = fd();
      f.set("cascade_series", String(cascade));
      // On success the action redirects away and never returns.
      const res = await deleteBookingAction(f);
      if (res && !res.ok) setRefusal(res);
    });
  }

  function skip() {
    if (
      !window.confirm(
        `Skip ${occurrenceDate} and tell the recurring series not to regenerate this date? The series continues as normal after.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await skipBookingOccurrenceAction(fd());
      if (res && !res.ok) setRefusal(res);
    });
  }

  // Past visits used to be flat-out undeletable — a wall, not a warning.
  // Brian's ruling: "I don't mind the recommendation, but it must be
  // removable." So the recommendation stays (the note below, the harder
  // confirm), and the owner decides. The MONEY rule is separate and still
  // hard: a booking billed by a live invoice refuses server-side until the
  // invoice is voided or deleted — with the refusal shown right here.
  return (
    <div className="space-y-4">
      {isPast && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          This visit is in the past — it&rsquo;s part of your records and
          reports. Deleting it removes it from both. Hours logged on it stay
          in Timesheets; if an invoice bills it, deletion is blocked until
          that invoice is dealt with first.
        </div>
      )}

      {refusal && (
        <div
          ref={panel}
          role="alert"
          className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <p className="font-semibold">{refusal.error}</p>
          {refusal.link && (
            <p className="mt-2">
              <Link href={refusal.link.href} className="font-medium underline underline-offset-2">
                {refusal.link.label}
              </Link>
            </p>
          )}
        </div>
      )}

      {/* Delete */}
      <div>
        {isRecurring && (
          <label className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              Also remove the rest of the series — this booking and every
              future occurrence. Past visits are kept.
            </span>
          </label>
        )}

        <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
          {pending ? "Working…" : cascade ? "Delete this + future" : "Delete booking"}
        </Button>
      </div>

      {/* Skip this occurrence — recurring only, alternative to delete */}
      {isRecurring && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
            Or keep the series alive but skip just this one date — useful for
            holidays or a client being away. The date is added to the
            series&rsquo; skip list so the nightly cron won&rsquo;t regenerate
            it.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={skip}>
            Skip {occurrenceDate} only
          </Button>
        </div>
      )}
    </div>
  );
}
