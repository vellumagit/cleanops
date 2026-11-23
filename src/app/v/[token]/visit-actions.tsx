"use client";

import { useActionState, useState } from "react";
import type { ClientJobActionState } from "@/lib/client-visit-requests";
import { visitCancelAction, visitMoveAction, visitNoteAction } from "./actions";

const empty: ClientJobActionState = {};

type Choice = "note" | "move" | "cancel";

/**
 * The three things a client can do about a visit, one at a time. Each is a
 * big button that opens its own short form; nothing happens until the form's
 * own button is pressed, and what happened is said in a sentence afterwards.
 */
export function VisitActions({
  token,
  companyName,
  cancelsAtOnce,
  button,
}: {
  token: string;
  companyName: string;
  /** Far enough out that cancelling takes effect straight away. */
  cancelsAtOnce: boolean;
  /** The company's colour for the main button, readable in both themes. */
  button: { backgroundColor: string; color: string; borderColor: string };
}) {
  const [open, setOpen] = useState<Choice | null>(null);
  const [note, sendNote, sendingNote] = useActionState(visitNoteAction, empty);
  const [move, sendMove, sendingMove] = useActionState(visitMoveAction, empty);
  const [cancel, sendCancel, sendingCancel] = useActionState(visitCancelAction, empty);

  if (cancel.ok) {
    return (
      <Done>
        {cancelsAtOnce
          ? `This visit is cancelled. ${companyName} has been told.`
          : `We've asked ${companyName} to cancel this visit. It's close, so they'll confirm with you. Until they do, it is still booked.`}
      </Done>
    );
  }

  const choice = (key: Choice, label: string) => (
    <button
      type="button"
      aria-expanded={open === key}
      onClick={() => setOpen(open === key ? null : key)}
      className="flex min-h-14 w-full items-center justify-between rounded-xl border border-border bg-card px-5 text-left text-lg font-medium transition-colors hover:bg-muted"
    >
      {label}
      <span aria-hidden className="text-muted-foreground">
        {open === key ? "−" : "+"}
      </span>
    </button>
  );
  const main = (label: string, pending: boolean) => (
    <button
      type="submit"
      disabled={pending}
      style={{ ...button, borderWidth: 1, borderStyle: "solid" }}
      className="flex min-h-14 w-full items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Sending…" : label}
    </button>
  );
  const box = "min-h-28 w-full rounded-xl border border-input bg-background px-4 py-3 text-base";

  return (
    <div className="space-y-3">
      {note.ok && <Done>Your note is with the cleaner and with {companyName}.</Done>}
      {move.ok && (
        <Done>
          We&rsquo;ve asked {companyName}. They&rsquo;ll be in touch about a new time. Until they are, your visit is
          still booked as shown.
        </Done>
      )}

      {choice("note", "Leave a note for the cleaner")}
      {open === "note" && (
        <form action={sendNote} className="space-y-3 rounded-xl border border-border p-4">
          <input type="hidden" name="token" value={token} />
          <Problem text={note.error} />
          <label className="block space-y-1.5">
            <span className="text-base font-medium">Your note</span>
            <textarea id="visit-note" name="body" required maxLength={1000} className={box} placeholder="The side gate code is 4412." />
          </label>
          {main("Send my note", sendingNote)}
        </form>
      )}

      {choice("move", "Ask to move this visit")}
      {open === "move" && (
        <form action={sendMove} className="space-y-3 rounded-xl border border-border p-4">
          <input type="hidden" name="token" value={token} />
          <Problem text={move.error} />
          <label className="block space-y-1.5">
            <span className="text-base font-medium">When would suit you better?</span>
            <textarea id="visit-move" name="wish" required maxLength={1000} className={box} placeholder="Any morning next week, or Friday afternoon." />
          </label>
          <p className="text-sm text-muted-foreground">
            {companyName} will get back to you with a time. Your visit stays as it is until they do.
          </p>
          {main("Ask to move it", sendingMove)}
        </form>
      )}

      {choice("cancel", "Cancel this visit")}
      {open === "cancel" && (
        <form action={sendCancel} className="space-y-3 rounded-xl border border-border p-4">
          <input type="hidden" name="token" value={token} />
          <Problem text={cancel.error} />
          <p className="text-base">
            {cancelsAtOnce
              ? "This cancels this one visit. Any other visits you have stay as they are."
              : `This visit is soon, so ${companyName} will need to confirm the cancellation with you.`}
          </p>
          <label className="block space-y-1.5">
            <span className="text-base font-medium">Anything we should know? (optional)</span>
            <textarea id="visit-cancel" name="reason" maxLength={1000} className="min-h-20 w-full rounded-xl border border-input bg-background px-4 py-3 text-base" />
          </label>
          {main(cancelsAtOnce ? "Yes, cancel this visit" : "Ask to cancel this visit", sendingCancel)}
        </form>
      )}
    </div>
  );
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
      {children}
    </div>
  );
}

function Problem({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-base text-destructive">
      {text}
    </div>
  );
}
