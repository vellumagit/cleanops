import type { JobTimelineEvent } from "@/lib/job-sync";

/**
 * What happened on this job, in order. Read-only; the state line above it
 * says where things stand now, this says how they got there.
 */
export function JobTimeline({
  events,
  tz,
}: {
  events: JobTimelineEvent[];
  tz: string;
}) {
  if (events.length === 0) return null;
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
  const dateLabel = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-xs font-medium text-muted-foreground">Timeline</p>
      <ol className="mt-2 space-y-1 text-sm">
        {events.map((e, i) => {
          const showDay = i === 0 || day(e.atMs) !== day(events[i - 1].atMs);
          return (
            <li key={i}>
              {showDay && (
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
                  {dateLabel(e.atMs)}
                </p>
              )}
              <div className="flex items-baseline gap-3">
                <span className="w-16 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {time(e.atMs)}
                </span>
                <span
                  className={
                    e.tone === "warn"
                      ? "text-amber-700 dark:text-amber-400"
                      : e.tone === "good"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-foreground"
                  }
                >
                  {e.text}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
