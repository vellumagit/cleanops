/**
 * When a task is due, in words, on the COMPANY's clock.
 *
 * The task list used to format these in the browser with the device's own
 * time zone: a task saved for 7:24 read 6:24 on a computer whose time zone
 * rules were out of date (Alberta stopped changing its clocks in November
 * 2026), and "today" was the device's today, not the company's. The page
 * works these out on the server now and hands the list finished text.
 */

export type DueBucket = "overdue" | "today" | "upcoming";

export type DueDescription = {
  label: string;
  /** Shown in red: the due day has passed. */
  urgent: boolean;
  bucket: DueBucket;
};

function ymdIn(tz: string, at: Date): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function timeIn(tz: string, at: Date): string {
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

function dayIn(tz: string, at: Date, withYear: boolean): string {
  return at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: tz,
  });
}

/**
 * A task is overdue once its due DAY has passed, not the minute: something
 * due at 9:00 this morning is still today's work at noon.
 */
export function describeDue(iso: string, tz: string, now: Date): DueDescription | null {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const dueDay = ymdIn(tz, due);
  const today = ymdIn(tz, now);
  if (dueDay < today) {
    return { label: `Overdue · ${dayIn(tz, due, false)}`, urgent: true, bucket: "overdue" };
  }
  if (dueDay === today) {
    return { label: `Today · ${timeIn(tz, due)}`, urgent: false, bucket: "today" };
  }
  if (dueDay === nextYmd(today)) {
    return { label: `Tomorrow · ${timeIn(tz, due)}`, urgent: false, bucket: "upcoming" };
  }
  return { label: `${dayIn(tz, due, true)} · ${timeIn(tz, due)}`, urgent: false, bucket: "upcoming" };
}

/** "Nov 20, 8:30 AM" on the company's clock. */
export function describeReminder(iso: string, tz: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${dayIn(tz, at, false)}, ${timeIn(tz, at)}`;
}
