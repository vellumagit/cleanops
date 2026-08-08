"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  resolveClientSkipAction,
  type ResolveState,
} from "./client-job-request-actions";

const empty: ResolveState = {};

export type OpenSkipRow = {
  id: string;
  booking_id: string | null;
  body: string | null;
  created_at: string;
  clientName: string;
  whenLabel: string;
  askedLabel: string;
};

/**
 * Skip requests that landed too close in to auto-apply, so they need a person.
 *
 * Sits above the new-booking requests on the same page because both are "a
 * client asked for something from the portal" — but this one is time-critical
 * in a way a new-work enquiry is not: the crew is already scheduled, and an
 * unanswered request is how the client ends up phoning anyway.
 */
export function OpenSkipRequests({ rows }: { rows: OpenSkipRow[] }) {
  const [state, action, pending] = useActionState(
    resolveClientSkipAction,
    empty,
  );

  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-400 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center gap-2 border-b border-amber-300 px-4 py-3 dark:border-amber-900/50">
        <CalendarX2 className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {rows.length === 1
            ? "A client wants to skip a visit"
            : `${rows.length} clients want to skip a visit`}
        </h2>
        <span className="ml-auto text-[11px] text-amber-800/70 dark:text-amber-200/60">
          Too close to cancel automatically
        </span>
      </div>

      {state.error && (
        <p role="alert" className="px-4 pt-3 text-xs text-destructive">
          {state.error}
        </p>
      )}

      <ul className="divide-y divide-amber-200 dark:divide-amber-900/40">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.booking_id ? (
                    <Link
                      href={`/app/bookings/${r.booking_id}`}
                      className="underline underline-offset-2"
                    >
                      {r.clientName}
                    </Link>
                  ) : (
                    r.clientName
                  )}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    — {r.whenLabel}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Asked {r.askedLabel}
                </p>
                {r.body && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    “{r.body}”
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                <form action={action}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <input type="hidden" name="accept" value="1" />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                  >
                    Cancel the visit
                  </Button>
                </form>
                <form action={action}>
                  <input type="hidden" name="request_id" value={r.id} />
                  <input type="hidden" name="accept" value="0" />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                  >
                    Keep it
                  </Button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
