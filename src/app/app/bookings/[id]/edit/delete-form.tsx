"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  deleteBookingAction,
  skipBookingOccurrenceAction,
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
  const isRecurring = Boolean(seriesId);
  const occurrenceDate = new Date(scheduledAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Past visits are historical records — the app never deletes them. Show a
  // protective note instead of the delete/skip controls.
  if (isPast) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
        This visit is in the past, so it&rsquo;s kept as part of your records and
        can&rsquo;t be deleted. To stop an ongoing recurring client, open an
        upcoming visit and choose &ldquo;Delete this + future&rdquo; — past
        visits always stay.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Delete form */}
      <form
        action={deleteBookingAction}
        onSubmit={(e) => {
          const msg = cascade
            ? "Delete this booking and every FUTURE occurrence in the series? Past visits are kept. This cannot be undone."
            : "Delete this booking? This cannot be undone.";
          if (!window.confirm(msg)) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="cascade_series" value={String(cascade)} />

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

        <SubmitButton variant="destructive" pendingLabel="Deleting…">
          {cascade ? "Delete this + future" : "Delete booking"}
        </SubmitButton>
      </form>

      {/* Skip this occurrence — recurring only, alternative to delete */}
      {isRecurring && (
        <form
          action={skipBookingOccurrenceAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Skip ${occurrenceDate} and tell the recurring series not to regenerate this date? The series continues as normal after.`,
              )
            )
              e.preventDefault();
          }}
          className="rounded-md border border-border bg-muted/30 p-3"
        >
          <input type="hidden" name="id" value={id} />
          <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
            Or keep the series alive but skip just this one date — useful for
            holidays or a client being away. The date is added to the
            series&rsquo; skip list so the nightly cron won&rsquo;t regenerate
            it.
          </p>
          <SubmitButton variant="outline" size="sm" pendingLabel="Skipping…">
            Skip {occurrenceDate} only
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
