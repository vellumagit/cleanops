"use client";

import { useActionState, useEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormField, FormSelect } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import {
  FEEDBACK_STATUSES,
  feedbackStatusLabel,
  type FeedbackStatus,
} from "@/lib/validators/feedback";
import { replyFeedbackAction, type FeedbackReplyFormState } from "../actions";

const empty: FeedbackReplyFormState = {};

/**
 * Reply and status live in one form on purpose.
 *
 * Answering a question and handing the ball back are the same act. Split into
 * two controls, boards fill up with threads whose last reply says "fixed!"
 * above a status that still reads open — and then nobody trusts the statuses,
 * and you are back to asking over voice.
 */
export function ReplyForm({
  id,
  currentStatus,
  canMoveStatus,
}: {
  id: string;
  currentStatus: FeedbackStatus;
  canMoveStatus: boolean;
}) {
  const action = replyFeedbackAction.bind(null, id);
  const [state, formAction] = useActionState(action, empty);
  const formRef = useRef<HTMLFormElement>(null);

  // A posted reply re-renders above this form; clear the box so the text
  // isn't sitting there looking unsent.
  //
  // Keyed on the state OBJECT, not on a derived boolean. useActionState hands
  // back a fresh {} on every success, but a boolean derived from it stays
  // `true` across them — the effect would fire once on mount and never again,
  // and every reply after the first would stay in the textarea.
  useEffect(() => {
    if (!state.errors) formRef.current?.reset();
  }, [state]);

  // Answering something that was waiting on you sends it back to Sollos —
  // preselect that, since it is what almost every reply here means.
  const suggested: FeedbackStatus =
    currentStatus === "needs_answer" ? "open" : currentStatus;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError message={state.errors?._form} />

      <FormField label="Reply" htmlFor="body" error={state.errors?.body}>
        <Textarea
          id="body"
          name="body"
          rows={3}
          required
          maxLength={4000}
          placeholder={
            currentStatus === "needs_answer"
              ? "Answer the question above…"
              : "Add detail, ask something, or say what changed…"
          }
        />
      </FormField>

      {canMoveStatus ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <FormField
            label="Then set to"
            htmlFor="status"
            className="sm:max-w-56 sm:flex-1"
            error={state.errors?.status}
          >
            <FormSelect id="status" name="status" defaultValue={suggested}>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <SubmitButton pendingLabel="Posting…">Post reply</SubmitButton>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {currentStatus === "needs_answer"
              ? "Replying sends this back to the Sollos team."
              : `Status stays ${feedbackStatusLabel(currentStatus).toLowerCase()}.`}
          </p>
          <SubmitButton pendingLabel="Posting…">Post reply</SubmitButton>
        </div>
      )}
    </form>
  );
}
