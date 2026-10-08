/**
 * Pure pieces of "a cleaner said they can't work": the wording managers get
 * notified with, and the day-off test the scheduler's warnings use. Kept free
 * of the database so both are unit-testable; the queries live in
 * unavailability-notice.ts.
 */

/** "Mon, Oct 12" for a YYYY-MM-DD calendar date. Read as a date, not an
 *  instant — noon UTC keeps every timezone on the same day. */
export function formatDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDayRange(startYmd: string, endYmd: string): string {
  return startYmd === endYmd
    ? formatDay(startYmd)
    : `${formatDay(startYmd)} – ${formatDay(endYmd)}`;
}

export type UnavailabilityKind = "time_off_request" | "day_off";

/**
 * The notification managers get. Leads with the jobs already booked in the
 * window, because that is the part that needs doing: a request with nothing
 * scheduled is a heads-up, one with jobs on it is work.
 */
export function buildUnavailabilityNotice({
  kind,
  name,
  startDate,
  endDate,
  bookedJobs,
}: {
  kind: UnavailabilityKind;
  name: string;
  startDate: string;
  endDate: string;
  /** Jobs this person is already on (as anyone on the crew) in the window. */
  bookedJobs: number;
}): { title: string; body: string } {
  const when = formatDayRange(startDate, endDate);
  const single = startDate === endDate;
  const jobs = `${bookedJobs} job${bookedJobs === 1 ? "" : "s"}`;

  if (kind === "time_off_request") {
    return {
      title: "Time-off request",
      body:
        `${name} asked for time off ${when}.` +
        (bookedJobs > 0
          ? ` Already on ${jobs} ${single ? "that day" : "in that window"} — they'll need cover if you approve.`
          : " Nothing is booked for them then."),
    };
  }
  return {
    title: "Marked unavailable",
    body:
      `${name} marked themselves unavailable ${when}.` +
      (bookedJobs > 0
        ? ` Already on ${jobs} that day — ${bookedJobs === 1 ? "it needs" : "they need"} cover.`
        : " Nothing is booked for them that day."),
  };
}

/**
 * Who on a job is booked on a day they said they're off. `offDays` is the
 * scheduler's map (approved time off + days marked unavailable), member →
 * YYYY-MM-DD dates; `dayFor` gives that member's start date for this job in
 * the org's timezone.
 */
export function crewOffOnJob(
  crew: string[],
  offDays: Record<string, readonly string[]>,
  dayFor: (memberId: string) => string,
): string[] {
  return crew.filter((m) => (offDays[m] ?? []).includes(dayFor(m)));
}
