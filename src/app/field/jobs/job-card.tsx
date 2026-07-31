import Link from "next/link";
import {
  ChevronRight,
  MapPin,
  CalendarClock,
  FileText,
  StickyNote,
} from "lucide-react";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { formatDateTime, formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FieldJob } from "./data";
import { JobCardComplete } from "./job-card-complete";
import { JobCardElapsed } from "./job-card-elapsed";

export function JobCard({ job, tz }: { job: FieldJob; tz: string }) {
  const inProgress = job.status === "in_progress";

  return (
    /*
     * The whole card navigates, but an in-progress card also carries an
     * "End job" button — so the link is an absolutely-positioned overlay
     * rather than a wrapper. Nesting a <button> inside an <a> is invalid and
     * behaves inconsistently on touch; this keeps both tap targets honest.
     */
    <div
      className={cn(
        "relative flex touch-manipulation items-center gap-3 rounded-xl border bg-card p-4 transition-all active:scale-[0.98]",
        job.needs_acceptance
          ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20"
          : inProgress
            ? "border-emerald-300 dark:border-emerald-900/50"
            : "border-border",
      )}
    >
      <Link
        href={`/field/jobs/${job.id}`}
        aria-label={`Open job for ${job.client?.name ?? "client"}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-base font-semibold">
            {job.client?.name ?? "—"}
          </span>
          {job.needs_acceptance ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
              <CalendarClock className="h-3 w-3" />
              Confirm
            </span>
          ) : (
            <StatusBadge
              tone={bookingStatusTone(
                job.status as
                  | "pending"
                  | "confirmed"
                  | "en_route"
                  | "in_progress"
                  | "completed"
                  | "cancelled",
              )}
            >
              {humanizeEnum(job.status)}
            </StatusBadge>
          )}
        </div>
        {/*
         * In progress, but this person's clock is NOT running — reachable
         * whenever the auto-close cron caps a forgotten shift, which closes
         * the time entry and leaves the booking open. Without this the card
         * showed a bare "End job" and no timer, which reads as "the timer is
         * broken" rather than "the system stopped your clock hours ago".
         */}
        {inProgress && !job.clocked_in_since ? (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              Job still open · you&rsquo;re not on the clock
            </span>
          </div>
        ) : null}
        {job.clocked_in_since ? (
          <div className="mt-1.5">
            <JobCardElapsed
              sinceIso={job.clocked_in_since}
              scheduledStartIso={job.effective_scheduled_at}
              scheduledMinutes={job.effective_duration_minutes}
              status={job.status}
            />
          </div>
        ) : null}
        <div className="mt-1.5 text-sm text-muted-foreground">
          {formatDateTime(job.effective_scheduled_at, tz)} ·{" "}
          {formatDurationMinutes(job.effective_duration_minutes)} ·{" "}
          {humanizeEnum(job.service_type)}
        </div>
        {job.display_address ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">{job.display_address}</span>
          </div>
        ) : null}
        {/*
         * Both notes, clamped. The list already fetched job.notes and threw
         * it away — a cleaner had to open the job to learn anything about it.
         * Clamped rather than full: this is a scan view, and the detail page
         * is one tap away for the rest.
         */}
        {job.notes ? (
          <div className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2 whitespace-pre-wrap">{job.notes}</span>
          </div>
        ) : null}
        {job.client_notes ? (
          <div className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2 whitespace-pre-wrap">
              {job.client_notes}
            </span>
          </div>
        ) : null}
      </div>

      {inProgress ? (
        <JobCardComplete bookingId={job.id} />
      ) : (
        <ChevronRight className="pointer-events-none h-5 w-5 shrink-0 text-muted-foreground" />
      )}
    </div>
  );
}
