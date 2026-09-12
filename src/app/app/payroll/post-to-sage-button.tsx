"use client";

import { useActionState } from "react";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { FormError } from "@/components/form-field";
import {
  postPayrollRunToSageAction,
  type PostToSageState,
} from "./actions";

const EMPTY: PostToSageState = {};

/**
 * "Post to Sage" for a paid payroll run — the retry path when the
 * background post didn't land. Journals have no page in Sage's web app to
 * link to, so a posted run shows its state, not a link.
 */
export function PostPayrollToSageButton({
  runId,
  posted,
}: {
  runId: string;
  posted: boolean;
}) {
  const [state, action] = useActionState<PostToSageState, FormData>(
    postPayrollRunToSageAction,
    EMPTY,
  );
  if (posted && !state.error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        Posted to Sage
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={runId} />
        <SubmitButton variant="outline" size="sm" pendingLabel="Posting…">
          <BookOpen className="h-4 w-4" />
          Post to Sage
        </SubmitButton>
      </form>
      {state.error && <FormError message={state.error} />}
      {state.ok && (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Posted to Sage.
        </p>
      )}
    </div>
  );
}
