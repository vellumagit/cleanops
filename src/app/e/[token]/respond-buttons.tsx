"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { respondToEstimateAction, type RespondToEstimateState } from "./actions";
import { brandButtonColors } from "@/lib/readable-on";

const initial: RespondToEstimateState = {};

/**
 * Approve / Decline on the client's estimate page. Decline asks once more
 * before it is sent, since it can't be taken back from here.
 */
export function RespondButtons({
  token,
  orgName,
  brandColor,
}: {
  token: string;
  orgName: string;
  brandColor: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(respondToEstimateAction, initial);
  const [declining, setDeclining] = useState(false);

  // The page's own banner shows the answer once it reloads.
  useEffect(() => {
    if (state.status) router.refresh();
  }, [state.status, router]);

  if (state.status) {
    return (
      <section
        role="status"
        className="print:hidden mt-8 rounded-lg border border-border bg-muted/30 p-5 text-center"
      >
        <p className="text-sm font-medium text-foreground">
          {state.status === "approved" ? "Approved. Thank you." : "Declined."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {state.status === "approved"
            ? `${orgName} has been told and will be in touch to schedule your service.`
            : `${orgName} has been told. If this was a mistake, reply to their email.`}
        </p>
      </section>
    );
  }

  return (
    <section className="print:hidden mt-8 rounded-lg border border-border p-5 text-center">
      <p className="text-sm font-medium text-foreground">Ready to go ahead?</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Approving tells {orgName} you accept this estimate. They&rsquo;ll
        confirm and schedule your service. Questions first? Reply to the email
        that brought you here.
      </p>

      {state.error && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-800">
          {state.error}
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <input type="hidden" name="token" value={token} />
        {declining ? (
          <>
            <span className="w-full text-xs text-foreground">Decline this estimate?</span>
            <button
              type="submit"
              name="decision"
              value="decline"
              disabled={pending}
              className="rounded-md border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Sending…" : "Yes, decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={pending}
              className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-foreground"
            >
              Go back
            </button>
          </>
        ) : (
          <>
            <button
              type="submit"
              name="decision"
              value="approve"
              disabled={pending}
              // Text colour chosen against the brand colour: white text on a
              // white or pale brand colour was a blank rectangle.
              style={brandButtonColors(brandColor)}
              className="rounded-md border px-5 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {pending ? "Sending…" : "Approve estimate"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              disabled={pending}
              className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-foreground"
            >
              Decline
            </button>
          </>
        )}
      </form>
    </section>
  );
}
