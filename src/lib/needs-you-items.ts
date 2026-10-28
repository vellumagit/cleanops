/**
 * The "Needs you" list: every question the jobs are asking a manager right
 * now, each with its answers built in.
 *
 * Managers handle exceptions, never states. Nobody should read "in
 * progress" and work out what it means; either a job is fine and silent, or
 * it asks one question here. Pure: the loader (needs-you.ts) fetches, this
 * decides, and it can be tested without a database.
 */
import { deriveJobState, teamMinutes, type JobStateShift } from "@/lib/job-state";
import { expectedEndMs } from "@/lib/shift-overrun";

export type NeedsYouKind =
  | "no_show_decision"
  | "not_clocked_in"
  | "over_hours"
  | "needs_price"
  | "tomorrow";

export type NeedsYouAction =
  | { kind: "close_job"; label: string; bookingId: string }
  | { kind: "snooze"; label: string; key: string; untilIso: string }
  | { kind: "remove_member"; label: string; bookingId: string; membershipId: string }
  | { kind: "clock_out_at"; label: string; entryId: string; bookingId: string; atIso: string }
  | { kind: "call"; label: string; phone: string }
  | { kind: "link"; label: string; href: string };

export type NeedsYouItem = {
  /** Stable across runs, so a snooze or a sent alert sticks to it. */
  key: string;
  kind: NeedsYouKind;
  title: string;
  body: string | null;
  href: string;
  /** For ordering: the moment the item is about. */
  atMs: number;
  actions: NeedsYouAction[];
  /** Push it to managers the first time it appears. */
  alert: boolean;
  /**
   * Also tell the one person who can fix it herself, once, in her words:
   * the cleaner who hasn't clocked in gets "tap I'm here when you arrive",
   * not the manager's question about her.
   */
  tell?: { membershipId: string; title: string; body: string; href: string };
};

export type NeedsYouCrew = {
  membership_id: string;
  name: string;
  phone: string | null;
  acceptance_status: string | null;
  has_login: boolean;
  split_start_offset_minutes: number | null;
  split_duration_minutes: number | null;
};

export type NeedsYouShift = JobStateShift & { id: string };

export type NeedsYouBooking = {
  id: string;
  clientName: string;
  status: string;
  scheduled_at: string;
  duration_minutes: number;
  total_cents: number | null;
  hourly_rate_cents: number | null;
  is_free: boolean | null;
  closed_at: string | null;
  /** Resolved "divide hours evenly": the row's flag or the org default. */
  divides_hours: boolean;
  crew: NeedsYouCrew[];
  shifts: NeedsYouShift[];
};

export type NeedsYouContext = {
  now: number;
  tz: string;
  autoCompleteAfterMinutes: number | null;
  /** YYYY-MM-DD in the org's zone. */
  tomorrowYmd: string;
  /** Membership ids off tomorrow (approved time off or a day marked off). */
  offTomorrow: Set<string>;
  /** Whether this org's crews clock in at all; if not, silence isn't news. */
  usesClockIn: boolean;
};

/** How late before "hasn't clocked in" becomes a manager's question. */
export const LATE_MINUTES = 30;
/** How far past her hours before "still on the clock" is worth a line. */
export const OVER_HOURS_MINUTES = 15;
/**
 * How far past before it's worth a push. Fifteen minutes over a shared
 * estimate is a normal clean; an hour is a forgotten clock-out, and the
 * cron that caps her shift measures against the full entered hours, so
 * on a divided job nothing else would say anything for a long time.
 */
export const OVER_HOURS_ALERT_MINUTES = 60;

const first = (name: string) => name.split(/\s+/)[0] || "Someone";

function timeIn(tz: string) {
  return (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    });
}

function ymdIn(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function buildJobItems(
  b: NeedsYouBooking,
  ctx: NeedsYouContext,
): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  if (b.status === "cancelled") return items;
  const time = timeIn(ctx.tz);
  const nameOf = new Map(b.crew.map((c) => [c.membership_id, c.name]));
  const name = (id: string) => first(nameOf.get(id) ?? "Someone");
  const href = `/app/bookings/${b.id}`;
  const startMs = new Date(b.scheduled_at).getTime();

  const state = deriveJobState({
    booking: b,
    crew: b.crew,
    shifts: b.shifts,
    now: ctx.now,
    autoCompleteAfterMinutes: ctx.autoCompleteAfterMinutes,
  });

  // Finished on site, someone rostered never showed. The rules won't close
  // it until the window ends; a person can, now.
  // (Not on a row already marked completed: the old closing rules, still
  // in charge until the computed state takes over, may have closed it.)
  // Not on a pending job either: "Close it" would be refused ("Confirm this
  // job before closing it"), so the question would have no good answer.
  if (
    state.phase === "finished_on_site" &&
    b.status !== "completed" &&
    b.status !== "pending"
  ) {
    const key = `no_show:${b.id}`;
    items.push({
      key,
      kind: "no_show_decision",
      title: `${b.clientName} is finished on site`,
      body: `${state.waitingOn.map(name).join(", ")} never clocked in. Closes itself ${time(state.windowEndMs)} if you do nothing.`,
      href,
      atMs: ctx.now,
      alert: true,
      actions: [
        { kind: "close_job", label: "Close it", bookingId: b.id },
        {
          kind: "snooze",
          label: "Still coming",
          key,
          untilIso: new Date(state.windowEndMs).toISOString(),
        },
      ],
    });
  }

  // Late: the job started a while ago and an accepted crew member has no
  // shift. The cleaner herself gets nudged by job-watch; this is the
  // office's side of it, with the two things the office can do.
  if (
    ctx.usesClockIn &&
    b.status !== "pending" &&
    b.status !== "completed" &&
    (state.phase === "not_started" || state.phase === "in_progress") &&
    ctx.now >= startMs + LATE_MINUTES * 60_000 &&
    ctx.now < state.windowEndMs
  ) {
    const worked = new Set(b.shifts.map((s) => s.employee_id));
    for (const c of b.crew) {
      if (worked.has(c.membership_id)) continue;
      if (c.acceptance_status === "pending") continue;
      // Her own later start isn't late yet.
      if (
        c.split_start_offset_minutes != null &&
        ctx.now < startMs + (c.split_start_offset_minutes + LATE_MINUTES) * 60_000
      )
        continue;
      const key = `late:${b.id}:${c.membership_id}`;
      const lateMin = Math.floor((ctx.now - startMs) / 60_000);
      const actions: NeedsYouAction[] = [];
      if (c.phone) actions.push({ kind: "call", label: "Call", phone: c.phone });
      actions.push(
        { kind: "remove_member", label: "Remove from job", bookingId: b.id, membershipId: c.membership_id },
        {
          kind: "snooze",
          label: "Give it an hour",
          key,
          untilIso: new Date(ctx.now + 60 * 60_000).toISOString(),
        },
      );
      items.push({
        key,
        kind: "not_clocked_in",
        title: `${first(c.name)} hasn't clocked in`,
        body: `${b.clientName} started ${minutesLabel(lateMin)} ago${state.onSite.length > 0 ? ` · ${state.onSite.length} of ${b.crew.length} there` : ""}`,
        href,
        atMs: startMs,
        alert: true,
        actions,
        // The 2026-10-27 gap: three clocked in, Ivanna didn't, and nothing
        // said a word to anyone — the job watcher stops looking at a job
        // the moment ANYONE clocks in on it. Her own nudge goes with the
        // manager's, so the person who can fix it hears first.
        tell: {
          membershipId: c.membership_id,
          title: `${b.clientName} started ${minutesLabel(lateMin)} ago`,
          body:
            state.onSite.length > 0
              ? `${state.onSite.length} of ${b.crew.length} are there. Tap I'm here when you arrive — or tell your manager if you can't make it.`
              : "Tap I'm here when you arrive — or tell your manager if you can't make it.",
          href: `/field/jobs/${b.id}`,
        },
      });
    }
  }

  // Past the job's expected end and still on the clock. Measured against
  // the crew's shared length (teamMinutes) — the office's question is "the
  // job should be over, is she?" — while the cron that caps her clock keeps
  // the full entered hours, so this asks a manager long before anything
  // automatic touches her shift.
  for (const s of b.shifts) {
    if (s.clock_out_at) continue;
    const own = b.crew.find((c) => c.membership_id === s.employee_id);
    const minutes =
      own?.split_duration_minutes && own.split_duration_minutes > 0
        ? own.split_duration_minutes
        : teamMinutes(b, b.crew.length);
    // No length, no "over". (A zero-length job would ask to clock her out
    // at the moment she clocked in, which the action rightly refuses.)
    if (minutes <= 0) continue;
    const end = expectedEndMs({
      clockInMs: new Date(s.clock_in_at).getTime(),
      scheduledStartMs: startMs + (own?.split_start_offset_minutes ?? 0) * 60_000,
      scheduledMinutes: minutes,
    });
    const overMin = Math.floor((ctx.now - end) / 60_000);
    if (overMin < OVER_HOURS_MINUTES) continue;
    const key = `over:${s.id}`;
    items.push({
      key,
      kind: "over_hours",
      title: `${name(s.employee_id)} is ${minutesLabel(overMin)} past her hours`,
      body: `${b.clientName} · on the clock since ${time(new Date(s.clock_in_at).getTime())}`,
      href: "/app/timesheets",
      atMs: end,
      alert: overMin >= OVER_HOURS_ALERT_MINUTES,
      actions: [
        {
          kind: "clock_out_at",
          label: `Clock out at ${time(end)}`,
          entryId: s.id,
          bookingId: b.id,
          atIso: new Date(end).toISOString(),
        },
        {
          kind: "snooze",
          label: "Still working",
          key,
          untilIso: new Date(ctx.now + 60 * 60_000).toISOString(),
        },
      ],
    });
  }

  // Done with nothing to invoice.
  if (state.phase === "done" && state.needs.includes("price")) {
    items.push({
      key: `price:${b.id}`,
      kind: "needs_price",
      title: `${b.clientName} on ${new Date(startMs).toLocaleDateString("en-US", { timeZone: ctx.tz, month: "short", day: "numeric" })} is done but has no price`,
      body: "Nothing was invoiced. Set the price, or tick Free if it was on the house.",
      href,
      atMs: startMs,
      alert: false,
      actions: [{ kind: "link", label: "Set price", href: `/app/bookings/${b.id}/edit` }],
    });
  }

  // Tomorrow's problems, found tonight.
  if (ymdIn(b.scheduled_at, ctx.tz) === ctx.tomorrowYmd && state.phase === "not_started") {
    const problems: string[] = [];
    if (b.crew.length === 0) problems.push("nobody assigned");
    const pending = b.crew.filter((c) => c.acceptance_status === "pending").map((c) => first(c.name));
    if (pending.length) problems.push(`${pending.join(", ")} ${pending.length === 1 ? "hasn't" : "haven't"} accepted`);
    const noLogin = b.crew.filter((c) => !c.has_login).map((c) => first(c.name));
    if (noLogin.length) problems.push(`${noLogin.join(", ")} can't sign in`);
    const off = b.crew.filter((c) => ctx.offTomorrow.has(c.membership_id)).map((c) => first(c.name));
    if (off.length) problems.push(`${off.join(", ")} ${off.length === 1 ? "is" : "are"} off tomorrow`);
    if (!b.is_free && !(b.total_cents ?? 0) && !(b.hourly_rate_cents ?? 0)) problems.push("no price");
    if (problems.length > 0) {
      items.push({
        key: `tomorrow:${b.id}`,
        kind: "tomorrow",
        title: `Tomorrow ${time(startMs)} · ${b.clientName}`,
        body: problems.join(" · "),
        href,
        atMs: startMs,
        alert: false,
        actions: [{ kind: "link", label: "Open job", href }],
      });
    }
  }

  return items;
}

/** Everything, ordered: live problems first, then tomorrow, then money. */
export function buildNeedsYou(
  bookings: NeedsYouBooking[],
  ctx: NeedsYouContext,
  snoozedUntil: Map<string, number>,
): NeedsYouItem[] {
  const rank: Record<NeedsYouKind, number> = {
    no_show_decision: 0,
    not_clocked_in: 1,
    over_hours: 2,
    tomorrow: 3,
    needs_price: 4,
  };
  return bookings
    .flatMap((b) => buildJobItems(b, ctx))
    .filter((it) => (snoozedUntil.get(it.key) ?? 0) <= ctx.now)
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.atMs - b.atMs);
}
