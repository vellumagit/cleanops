import { describe, it, expect } from "vitest";
import {
  buildJobItems,
  buildNeedsYou,
  type NeedsYouBooking,
  type NeedsYouContext,
} from "./needs-you-items";

const T = (iso: string) => new Date(iso).getTime();
const crew = (id: string, over: Partial<NeedsYouBooking["crew"][number]> = {}) => ({
  membership_id: id,
  name: { p: "Pristine Standard", a: "Alona Smirnova", i: "Ivanna Boyko" }[id] ?? id,
  phone: null,
  acceptance_status: "accepted",
  has_login: true,
  split_start_offset_minutes: null,
  split_duration_minutes: null,
  ...over,
});
const shift = (id: string, who: string, inAt: string, outAt: string | null = null) => ({
  id,
  employee_id: who,
  clock_in_at: inAt,
  clock_out_at: outAt,
});

function booking(over: Partial<NeedsYouBooking> = {}): NeedsYouBooking {
  return {
    id: "b1",
    clientName: "Lori Moeller",
    status: "confirmed",
    scheduled_at: "2026-10-27T15:00:00Z",
    duration_minutes: 1080,
    total_cents: 36000,
    hourly_rate_cents: null,
    is_free: false,
    closed_at: null,
    divides_hours: false,
    crew: [crew("p"), crew("a"), crew("i")],
    shifts: [],
    ...over,
  };
}
function ctx(over: Partial<NeedsYouContext> = {}): NeedsYouContext {
  return {
    now: T("2026-10-27T15:00:00Z"),
    tz: "America/Edmonton",
    autoCompleteAfterMinutes: 240,
    tomorrowYmd: "2026-10-28",
    offTomorrow: new Set(),
    usesClockIn: true,
    ...over,
  };
}

describe("buildJobItems", () => {
  it("does not ask a no-show question on a pending job — Close it would be refused", () => {
    const items = buildJobItems(
      booking({
        status: "pending",
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
      }),
      ctx({ now: T("2026-10-27T18:35:00Z") }),
    );
    expect(items.find((i) => i.kind === "no_show_decision")).toBeUndefined();
  });

  it("a zero-length job is never 'past her hours'", () => {
    const items = buildJobItems(
      booking({
        status: "in_progress",
        duration_minutes: 0,
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
      }),
      ctx({ now: T("2026-10-27T15:20:00Z") }),
    );
    expect(items.find((i) => i.kind === "over_hours")).toBeUndefined();
  });

  it("measures 'past her hours' against the crew's shared length when hours divide", () => {
    // 18h entered, 3 crew, dividing → a 6-hour job ending 3:00 PM (21:00Z).
    // Pristine is still on the clock at 3:20 PM.
    const items = buildJobItems(
      booking({
        status: "in_progress",
        divides_hours: true,
        shifts: [
          shift("s1", "p", "2026-10-27T15:00:00Z"),
          shift("s2", "a", "2026-10-27T15:00:00Z", "2026-10-27T20:50:00Z"),
          shift("s3", "i", "2026-10-27T15:00:00Z", "2026-10-27T20:55:00Z"),
        ],
      }),
      ctx({ now: T("2026-10-27T21:20:00Z") }),
    );
    const over = items.find((i) => i.kind === "over_hours");
    expect(over?.title).toBe("Pristine is 20 min past her hours");
    expect(over?.actions[0]).toMatchObject({ kind: "clock_out_at", atIso: "2026-10-27T21:00:00.000Z" });
    // Twenty minutes over is a normal clean: on the list, not a push. An
    // hour over is a forgotten clock-out: push once.
    expect(over?.alert).toBe(false);
    const hourOver = buildJobItems(
      booking({
        status: "in_progress",
        divides_hours: true,
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
      }),
      ctx({ now: T("2026-10-27T22:05:00Z") }),
    ).find((i) => i.kind === "over_hours");
    expect(hourOver?.alert).toBe(true);
    // Without dividing the same picture is 18 hours of window: nothing to ask.
    const flat = buildJobItems(
      booking({
        status: "in_progress",
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
      }),
      ctx({ now: T("2026-10-27T21:20:00Z") }),
    );
    expect(flat.find((i) => i.kind === "over_hours")).toBeUndefined();
  });

  it("asks about a no-show once everyone who came has gone", () => {
    const items = buildJobItems(
      booking({
        status: "in_progress",
        shifts: [
          shift("s1", "p", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
          shift("s2", "a", "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
        ],
      }),
      ctx({ now: T("2026-10-27T18:35:00Z") }),
    );
    expect(items.map((i) => i.kind)).toEqual(["no_show_decision"]);
    expect(items[0].body).toBe("Ivanna never clocked in. Closes itself 3:00 AM if you do nothing.");
    expect(items[0].actions.map((a) => a.label)).toEqual(["Close it", "Still coming"]);
    expect(items[0].alert).toBe(true);
  });

  it("doesn't ask about a no-show, or a late arrival, on a job already closed or still pending", () => {
    const shifts = [
      shift("s1", "p", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
      shift("s2", "a", "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
    ];
    expect(
      buildJobItems(booking({ status: "completed", shifts }), ctx({ now: T("2026-10-27T18:35:00Z") })),
    ).toEqual([]);
    expect(
      buildJobItems(booking({ status: "pending" }), ctx({ now: T("2026-10-27T15:40:00Z") })),
    ).toEqual([]);
  });

  it("flags who hasn't clocked in 30 minutes after the start, with call and remove", () => {
    const items = buildJobItems(
      booking({
        status: "in_progress",
        crew: [crew("p"), crew("a"), crew("i", { phone: "+17805550100" })],
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z"), shift("s2", "a", "2026-10-27T14:59:00Z")],
      }),
      ctx({ now: T("2026-10-27T15:35:00Z") }),
    );
    expect(items.map((i) => i.kind)).toEqual(["not_clocked_in"]);
    expect(items[0].title).toBe("Ivanna hasn't clocked in");
    expect(items[0].body).toBe("Lori Moeller started 35 min ago · 2 of 3 there");
    expect(items[0].actions.map((a) => a.kind)).toEqual(["call", "remove_member", "snooze"]);
  });

  it("measures a split-shift cleaner's lateness from her own start, and defers to the job watcher's nudge", () => {
    // Ivanna's part begins 4h in (1:00 PM). At 1:20 she isn't late; at 1:35
    // she is 35 minutes late, not 4h 35m.
    const split = booking({
      status: "in_progress",
      crew: [crew("p"), crew("i", { split_start_offset_minutes: 240, split_duration_minutes: 240 })],
      shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
    });
    expect(buildJobItems(split, ctx({ now: T("2026-10-27T19:20:00Z") }))).toEqual([]);
    const items = buildJobItems(split, ctx({ now: T("2026-10-27T19:35:00Z") }));
    expect(items.map((i) => i.kind)).toEqual(["not_clocked_in"]);
    expect(items[0].body).toBe("Ivanna's part of Lori Moeller started 35 min ago · 1 of 2 there");
    expect(items[0].tell?.title).toBe("Your part of Lori Moeller started 35 min ago");
    expect(items[0].tell?.unlessSent).toEqual(["late_start:b1:i"]);
  });

  it("stays quiet in the first 30 minutes, for pending crew, and for orgs that don't clock in", () => {
    const late = booking({ shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")] });
    expect(buildJobItems(late, ctx({ now: T("2026-10-27T15:20:00Z") }))).toEqual([]);
    expect(buildJobItems(late, ctx({ now: T("2026-10-27T15:40:00Z"), usesClockIn: false }))).toEqual([]);
    const pending = booking({
      crew: [crew("p"), crew("i", { acceptance_status: "pending" })],
      shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
    });
    expect(buildJobItems(pending, ctx({ now: T("2026-10-27T15:40:00Z") }))).toEqual([]);
  });

  it("offers to clock someone out at the end of her hours, not the divided share", () => {
    // Pristine alone on an 18h booking; past 18h + 15 min.
    const items = buildJobItems(
      booking({
        status: "in_progress",
        crew: [crew("p")],
        shifts: [shift("s1", "p", "2026-10-27T15:00:00Z")],
      }),
      ctx({ now: T("2026-10-28T09:20:00Z") }),
    );
    expect(items.map((i) => i.kind)).toEqual(["over_hours"]);
    expect(items[0].title).toBe("Pristine is 20 min past her hours");
    const out = items[0].actions[0];
    expect(out.kind).toBe("clock_out_at");
    expect(out.kind === "clock_out_at" && out.atIso).toBe("2026-10-28T09:00:00.000Z");
    expect(out.label).toBe("Clock out at 3:00 AM");
  });

  it("asks for a price on a finished job, unless it's free", () => {
    const done = booking({
      status: "completed",
      closed_at: "2026-10-27T23:25:00Z",
      total_cents: 0,
      shifts: [shift("s1", "p", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
    });
    const items = buildJobItems(done, ctx({ now: T("2026-10-28T00:00:00Z") }));
    expect(items.map((i) => i.kind)).toEqual(["needs_price"]);
    expect(buildJobItems({ ...done, is_free: true }, ctx({ now: T("2026-10-28T00:00:00Z") }))).toEqual([]);
  });

  it("lists tomorrow's problems in one line", () => {
    const items = buildJobItems(
      booking({
        scheduled_at: "2026-10-28T15:00:00Z",
        total_cents: 0,
        crew: [crew("p", { acceptance_status: "pending" }), crew("a", { has_login: false }), crew("i")],
      }),
      ctx({ offTomorrow: new Set(["i"]) }),
    );
    expect(items.map((i) => i.kind)).toEqual(["tomorrow"]);
    expect(items[0].title).toBe("Tomorrow 9:00 AM · Lori Moeller");
    expect(items[0].body).toBe(
      "Pristine hasn't accepted · Alona can't sign in · Ivanna is off tomorrow · no price",
    );
    // A clean job tomorrow says nothing.
    expect(buildJobItems(booking({ scheduled_at: "2026-10-28T15:00:00Z" }), ctx())).toEqual([]);
  });
});

describe("buildNeedsYou", () => {
  it("drops snoozed items and orders live problems first", () => {
    const now = T("2026-10-27T18:35:00Z");
    const noShow = booking({
      id: "b1",
      status: "in_progress",
      shifts: [shift("s1", "p", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"), shift("s2", "a", "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
    });
    const unpriced = booking({
      id: "b2",
      clientName: "Jesse Schewchuk",
      status: "completed",
      closed_at: "2026-10-26T20:00:00Z",
      scheduled_at: "2026-10-26T15:00:00Z",
      total_cents: 0,
      crew: [crew("p")],
      shifts: [shift("s3", "p", "2026-10-26T15:00:00Z", "2026-10-26T18:00:00Z")],
    });
    const all = buildNeedsYou([unpriced, noShow], ctx({ now }), new Map());
    expect(all.map((i) => i.kind)).toEqual(["no_show_decision", "needs_price"]);
    const snoozed = buildNeedsYou([unpriced, noShow], ctx({ now }), new Map([["no_show:b1", now + 60_000]]));
    expect(snoozed.map((i) => i.kind)).toEqual(["needs_price"]);
  });
});
