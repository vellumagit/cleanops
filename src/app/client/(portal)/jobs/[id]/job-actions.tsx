"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, CalendarX2, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { skipConfirmCopy } from "@/lib/client-job-requests";
import {
  askToMoveAction,
  leaveJobNoteAction,
  requestSkipAction,
  type ClientJobActionState,
} from "./actions";

const empty: ClientJobActionState = {};

/**
 * The three things a client can do to a visit: leave a note, ask to move
 * it, skip it. (The private link in a booking email offers the same three:
 * app/v/[token].)
 *
 * Both are deliberately behind a disclosure rather than sitting open: this
 * screen is mostly read — when is it, who is coming — and a permanently open
 * textarea makes a page look like a form to fill in rather than an answer.
 */
export function ClientJobActions({
  bookingId,
  canNote,
  canSkip,
  skipAutoApplies,
  reason,
}: {
  bookingId: string;
  canNote: boolean;
  canSkip: boolean;
  skipAutoApplies: boolean;
  reason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "note" | "move" | "skip">(null);

  const [noteState, noteAction, notePending] = useActionState(
    leaveJobNoteAction,
    empty,
  );
  const [skipState, skipAction, skipPending] = useActionState(
    requestSkipAction,
    empty,
  );

  const [moveState, moveAction, movePending] = useActionState(
    askToMoveAction,
    empty,
  );

  // A completed action leaves the page stale until the server data comes back.
  if ((noteState.ok || skipState.ok || moveState.ok) && open) {
    setOpen(null);
    router.refresh();
  }

  if (!canNote && !canSkip) {
    return reason ? (
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] text-muted-foreground">
        {reason}
      </p>
    ) : null;
  }

  const copy = skipConfirmCopy(skipAutoApplies);

  return (
    <div className="space-y-3">
      {moveState.ok && open === null && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          We&rsquo;ve passed that on. The office will be in touch about a new time. Until they are, this visit is
          still booked as shown.
        </p>
      )}
      {open === null && (
        <div className="grid gap-2 sm:grid-cols-2">
          {canNote && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 justify-start"
              onClick={() => setOpen("note")}
            >
              <MessageSquarePlus className="mr-2 h-4 w-4" />
              Leave a note for this visit
            </Button>
          )}
          {canNote && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 justify-start"
              onClick={() => setOpen("move")}
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              Ask to move this visit
            </Button>
          )}
          {canSkip && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 justify-start"
              onClick={() => setOpen("skip")}
            >
              <CalendarX2 className="mr-2 h-4 w-4" />
              {skipAutoApplies ? "Skip this cleaning" : "Ask to skip"}
            </Button>
          )}
        </div>
      )}

      {open === "note" && (
        <form
          action={noteAction}
          className="rounded-xl border border-border bg-card p-4"
        >
          <input type="hidden" name="booking_id" value={bookingId} />
          <h2 className="text-sm font-semibold">Note for this visit</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Goes straight to the cleaner coming to you. Just for this visit —
            it won&rsquo;t change your standing instructions.
          </p>
          <Textarea
            name="body"
            required
            maxLength={1000}
            rows={4}
            className="mt-3"
            placeholder="e.g. Please skip the bathroom this week — it's just been redone."
          />
          {noteState.error && (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {noteState.error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="lg" className="h-11 flex-1" disabled={notePending}>
              {notePending ? "Sending…" : "Send to my cleaner"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => setOpen(null)}
              disabled={notePending}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {open === "move" && (
        <form action={moveAction} className="rounded-xl border border-border bg-card p-4">
          <input type="hidden" name="booking_id" value={bookingId} />
          <h2 className="text-base font-semibold">When would suit you better?</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The office will come back to you with a time. This visit stays as it is until they do.
          </p>
          <Textarea
            name="wish"
            required
            maxLength={1000}
            rows={3}
            className="mt-3"
            placeholder="e.g. Any morning next week, or Friday afternoon."
          />
          {moveState.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {moveState.error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="lg" className="h-11 flex-1" disabled={movePending}>
              {movePending ? "Sending…" : "Ask to move it"}
            </Button>
            <Button type="button" variant="ghost" size="lg" className="h-11" onClick={() => setOpen(null)} disabled={movePending}>
              Never mind
            </Button>
          </div>
        </form>
      )}

      {open === "skip" && (
        <form
          action={skipAction}
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <input type="hidden" name="booking_id" value={bookingId} />
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {copy.title}
          </h2>
          <p className="mt-0.5 text-[13px] text-amber-800/80 dark:text-amber-200/70">
            {copy.body}
          </p>
          <Textarea
            name="reason"
            rows={2}
            maxLength={500}
            className="mt-3 bg-card"
            placeholder="Anything they should know? (optional)"
          />
          {skipState.error && (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {skipState.error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="lg" className="h-11 flex-1" disabled={skipPending}>
              {skipPending ? "Sending…" : copy.cta}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => setOpen(null)}
              disabled={skipPending}
            >
              Keep it
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
