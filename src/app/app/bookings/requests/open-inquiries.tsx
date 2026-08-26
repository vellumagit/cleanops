"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import {
  resolveClientSkipAction,
  type ResolveState,
} from "./client-job-request-actions";

const empty: ResolveState = {};

/**
 * Open website inquiries and client notes — the job_note half of
 * client_job_requests, which this page never listed: the inbox showed only
 * skip requests, so Brian's first live contact-form test produced a lead, a
 * request row, two emails, a notification… and an inbox that looked empty.
 *
 * Resolving reuses the skip action (it marks any kind resolved; the
 * booking-cancel side effect only fires for accepted skips). Converting or
 * losing the lead resolves these automatically — the buttons here are for
 * "answered them, nothing else to do".
 */
export type OpenInquiryRow = {
  id: string;
  clientId: string;
  clientName: string;
  body: string;
  askedLabel: string;
};

export function OpenInquiries({ rows }: { rows: OpenInquiryRow[] }) {
  const [state, action, pending] = useActionState(
    resolveClientSkipAction,
    empty,
  );

  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-sky-300/60 bg-sky-500/5 p-4 dark:border-sky-900/50">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <h2 className="text-sm font-semibold">
          Inquiries &amp; notes ({rows.length})
        </h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Website inquiries and notes from clients. Converting a lead (or
        marking one lost) resolves theirs automatically — resolve here when
        you&rsquo;ve answered and there&rsquo;s nothing else to do.
      </p>
      {state.error && (
        <p className="mt-2 text-xs font-medium text-destructive">
          {state.error}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-md border border-border bg-card px-3 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/app/clients/${r.clientId}/edit`}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    {r.clientName}
                  </Link>
                  <span className="text-[11px] text-muted-foreground">
                    {r.askedLabel}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {r.body}
                </p>
              </div>
              <form action={action} className="shrink-0">
                <input type="hidden" name="request_id" value={r.id} />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  pendingLabel="Resolving…"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Resolve
                </SubmitButton>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
