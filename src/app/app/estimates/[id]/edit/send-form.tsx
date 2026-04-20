"use client";

import { useActionState } from "react";
import { Mail, Check } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import {
  sendEstimateAction,
  type SendEstimateState,
} from "../../actions";

type Props = {
  estimateId: string;
  clientHasEmail: boolean;
  lastSentAt: string | null;
};

export function SendEstimateForm({
  estimateId,
  clientHasEmail,
  lastSentAt,
}: Props) {
  const [state, formAction] = useActionState<SendEstimateState, FormData>(
    sendEstimateAction,
    {},
  );

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Mail className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Send to client</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Emails the client a branded link to view the estimate online.
            You&rsquo;ll get a reply if they want to book.
          </p>

          {!clientHasEmail ? (
            <p className="mt-3 text-xs text-amber-700">
              This client has no email on file — add one on the client record
              to enable sending.
            </p>
          ) : (
            <>
              {lastSentAt && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  Last sent{" "}
                  {new Date(lastSentAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}

              {state.ok && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  Sent — the client should see it within a minute.
                </p>
              )}

              {state.error && (
                <p className="mt-3 text-xs text-red-700">{state.error}</p>
              )}

              <form action={formAction} className="mt-4">
                <input type="hidden" name="id" value={estimateId} />
                <SubmitButton
                  size="sm"
                  pendingLabel="Sending…"
                >
                  <Mail className="h-4 w-4" />
                  {lastSentAt ? "Resend to client" : "Send to client"}
                </SubmitButton>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
