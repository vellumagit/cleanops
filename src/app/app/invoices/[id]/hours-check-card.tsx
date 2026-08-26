import Link from "next/link";
import { Timer, TriangleAlert } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invoiceHoursCheck } from "@/lib/invoice-hours-check";
import { formatDate, formatDurationMinutes, humanizeEnum } from "@/lib/format";

/**
 * "Did I bill the time the girls actually worked?" — rendered as a card on
 * the invoice, one row per billed job, one line per cleaner. Two cleaners
 * on one job sit side by side, so unequal team hours answer themselves.
 *
 * Advisory surface: it renders nothing when the invoice bills no bookings
 * (manual invoices have no hours to check) and swallows its own errors —
 * a cross-check must never take the invoice page down.
 */
export async function HoursCheckCard({
  invoiceId,
  tz,
}: {
  invoiceId: string;
  tz: string;
}) {
  try {
    const supabase = await createSupabaseServerClient();
    const check = await invoiceHoursCheck(supabase, invoiceId);
    if (!check) return null;

    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4 text-muted-foreground" />
          <p className="sollos-label">Hours check</p>
          {check.anyFlagged && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-3 w-3" />
              Doesn&apos;t line up
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          What this invoice bills, next to what the crew clocked.
        </p>

        <div className="mt-3 space-y-3">
          {check.jobs.map((job) => (
            <div
              key={job.bookingId}
              className="rounded-md border border-border/70 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <Link
                  href={`/app/bookings/${job.bookingId}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {formatDate(job.scheduledAt, tz)}
                  {job.serviceLabel
                    ? ` · ${humanizeEnum(job.serviceLabel)}`
                    : ""}
                </Link>
                <span className="tabular-nums text-muted-foreground">
                  {job.durationMinutes != null
                    ? `booked ${formatDurationMinutes(job.durationMinutes)}`
                    : "no duration set"}
                </span>
              </div>

              {job.noHours ? (
                <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Completed with no hours clocked on it — nobody&apos;s time is
                  attached to this job.
                </p>
              ) : job.people.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  No hours clocked yet ({job.bookingStatus} job).
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {job.people.map((p) => (
                    <li
                      key={p.membershipId}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span
                          className={
                            p.flagged
                              ? "font-semibold text-amber-700 dark:text-amber-400"
                              : "text-foreground"
                          }
                        >
                          {formatDurationMinutes(p.loggedMinutes)}
                        </span>
                        {p.hasOpenEntry && (
                          <span className="text-[10px] text-muted-foreground">
                            still clocked in
                          </span>
                        )}
                        {p.flagged && p.deltaMinutes != null && (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            {p.deltaMinutes > 0 ? "+" : "−"}
                            {formatDurationMinutes(Math.abs(p.deltaMinutes))}{" "}
                            vs {formatDurationMinutes(p.expectedMinutes ?? 0)}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  } catch (err) {
    console.error("[hours-check] failed to render:", err);
    return null;
  }
}
