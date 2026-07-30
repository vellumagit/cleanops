import Link from "next/link";
import { ChevronRight, MapPin, CalendarClock } from "lucide-react";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { formatDateTime, formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FieldJob } from "./data";
import { JobCardComplete } from "./job-card-complete";

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
      </div>

      {inProgress ? (
        <JobCardComplete bookingId={job.id} />
      ) : (
        <ChevronRight className="pointer-events-none h-5 w-5 shrink-0 text-muted-foreground" />
      )}
    </div>
  );
}
