import { describe, it, expect } from "vitest";
import {
  computeBookingWarnings,
  type WarnableBooking,
} from "./booking-warnings";

const NOW = new Date("2026-07-30T18:00:00Z").getTime(); // noon MDT
const H = 3_600_000;

function bk(over: Partial<WarnableBooking> = {}): WarnableBooking {
  return {
    id: crypto.randomUUID(),
    client_id: "client-1",
    client_name: "Acme",
    scheduled_at: new Date(NOW + 48 * H).toISOString(),
    duration_minutes: 120,
    status: "confirmed",
    total_cents: 20000,
    hourly_rate_cents: null,
    assigned_to: "jim",
    additional_assignee_ids: [],
    covered_by_name: null,
    ...over,
  };
}
const codes = (m: Map<string, { code: string }[]>, id: string) =>
  (m.get(id) ?? []).map((w) => w.code);

describe("healthy bookings stay silent", () => {
  it("a normal upcoming staffed job warns about nothing", () => {
    const b = bk();
    expect(computeBookingWarnings([b], NOW).get(b.id)).toBeUndefined();
  });
  it("a completed past job warns about nothing", () => {
    const b = bk({
      status: "completed",
      scheduled_at: new Date(NOW - 72 * H).toISOString(),
      assigned_to: null,
    });
    expect(computeBookingWarnings([b], NOW).get(b.id)).toBeUndefined();
  });
});

describe("double-booking", () => {
  it("flags both sides when one person overlaps", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    // starts 1h into a's 2h window
    const b = bk({
      scheduled_at: new Date(NOW + 25 * H).toISOString(),
      client_name: "Beta",
    });
    const m = computeBookingWarnings([a, b], NOW);
    expect(codes(m, a.id)).toContain("double_booked");
    expect(codes(m, b.id)).toContain("double_booked");
    expect(m.get(a.id)![0].detail).toContain("Beta");
  });

  it("back-to-back jobs are fine", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    const b = bk({ scheduled_at: new Date(NOW + 26 * H).toISOString() });
    const m = computeBookingWarnings([a, b], NOW);
    expect(codes(m, a.id)).not.toContain("double_booked");
  });

  it("different people at the same time are fine", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    const b = bk({
      scheduled_at: new Date(NOW + 24 * H).toISOString(),
      assigned_to: "other",
      client_id: "client-2",
    });
    expect(codes(computeBookingWarnings([a, b], NOW), a.id)).not.toContain(
      "double_booked",
    );
  });

  it("detects overlap via crew, not just the primary assignee", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    const b = bk({
      scheduled_at: new Date(NOW + 25 * H).toISOString(),
      assigned_to: null,
      additional_assignee_ids: ["jim"],
      client_id: "client-2",
    });
    expect(codes(computeBookingWarnings([a, b], NOW), b.id)).toContain(
      "double_booked",
    );
  });

  it("cancelled jobs don't create conflicts", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    const b = bk({
      scheduled_at: new Date(NOW + 25 * H).toISOString(),
      status: "cancelled",
      client_id: "client-2",
    });
    expect(codes(computeBookingWarnings([a, b], NOW), a.id)).not.toContain(
      "double_booked",
    );
  });
});

describe("staffing", () => {
  it("past + nobody ever assigned = never staffed", () => {
    const b = bk({
      scheduled_at: new Date(NOW - 48 * H).toISOString(),
      assigned_to: null,
    });
    expect(codes(computeBookingWarnings([b], NOW), b.id)).toContain(
      "never_staffed",
    );
  });

  it("a bench claim counts as staffed", () => {
    const b = bk({
      scheduled_at: new Date(NOW - 48 * H).toISOString(),
      assigned_to: null,
      covered_by_name: "Dana (bench)",
    });
    expect(codes(computeBookingWarnings([b], NOW), b.id)).not.toContain(
      "never_staffed",
    );
  });

  it("crew-only counts as staffed — the existing list's false positive", () => {
    const b = bk({
      scheduled_at: new Date(NOW - 48 * H).toISOString(),
      assigned_to: null,
      additional_assignee_ids: ["someone"],
    });
    expect(computeBookingWarnings([b], NOW).get(b.id)).toBeUndefined();
  });

  it("unassigned within 24h warns, but not 48h out", () => {
    const soon = bk({
      scheduled_at: new Date(NOW + 6 * H).toISOString(),
      assigned_to: null,
    });
    const later = bk({
      scheduled_at: new Date(NOW + 48 * H).toISOString(),
      assigned_to: null,
      client_id: "c2",
    });
    const m = computeBookingWarnings([soon, later], NOW);
    expect(codes(m, soon.id)).toContain("unassigned_soon");
    expect(codes(m, later.id)).not.toContain("unassigned_soon");
  });
});

describe("stuck and unpriced", () => {
  it("in_progress long past its end is flagged", () => {
    const b = bk({
      status: "in_progress",
      scheduled_at: new Date(NOW - 48 * H).toISOString(),
    });
    expect(codes(computeBookingWarnings([b], NOW), b.id)).toContain(
      "stuck_in_progress",
    );
  });

  it("$0 with no hourly rate is flagged", () => {
    const b = bk({ total_cents: 0 });
    expect(codes(computeBookingWarnings([b], NOW), b.id)).toContain("no_price");
  });

  it("$0 WITH an hourly rate is time-and-materials, not a mistake", () => {
    const b = bk({ total_cents: 0, hourly_rate_cents: 6500 });
    expect(codes(computeBookingWarnings([b], NOW), b.id)).not.toContain(
      "no_price",
    );
  });
});

describe("duplicates", () => {
  it("same client at the exact same time flags both", () => {
    const when = new Date(NOW + 24 * H).toISOString();
    const a = bk({ scheduled_at: when });
    const b = bk({ scheduled_at: when, assigned_to: "other" });
    const m = computeBookingWarnings([a, b], NOW);
    expect(codes(m, a.id)).toContain("possible_duplicate");
    expect(codes(m, b.id)).toContain("possible_duplicate");
  });

  it("same client at different times is normal recurring work", () => {
    const a = bk({ scheduled_at: new Date(NOW + 24 * H).toISOString() });
    const b = bk({
      scheduled_at: new Date(NOW + 24 * H + 7 * 24 * H).toISOString(),
    });
    expect(codes(computeBookingWarnings([a, b], NOW), a.id)).not.toContain(
      "possible_duplicate",
    );
  });
});

describe("split shifts are a hand-off, not a clash", () => {
  it("does not flag two people covering halves of one long job", () => {
    // 9am–3pm job: Maria 9–12, Ana 12–3. Same booking, so both rows share
    // scheduled_at and duration — only the segments tell them apart.
    const start = new Date(NOW + 48 * H).toISOString();
    const a = bk({
      scheduled_at: start,
      duration_minutes: 360,
      assigned_to: "maria",
      additional_assignee_ids: ["ana"],
      assignee_segments: {
        maria: { start_offset_minutes: 0, duration_minutes: 180 },
        ana: { start_offset_minutes: 180, duration_minutes: 180 },
      },
    });
    expect(computeBookingWarnings([a], NOW).get(a.id)).toBeUndefined();
  });

  it("lets a cleaner take a second job in the half they are not working", () => {
    // Ana works the back half (12–3) of the split, so a 9–11 job elsewhere
    // that morning is genuinely free time — the full-booking measure said
    // she was busy from 9am.
    const start = new Date(NOW + 48 * H).toISOString();
    const split = bk({
      client_name: "Long House",
      scheduled_at: start,
      duration_minutes: 360,
      assigned_to: "maria",
      additional_assignee_ids: ["ana"],
      assignee_segments: {
        maria: { start_offset_minutes: 0, duration_minutes: 180 },
        ana: { start_offset_minutes: 180, duration_minutes: 180 },
      },
    });
    const morning = bk({
      client_name: "Corner Cafe",
      scheduled_at: start,
      duration_minutes: 120,
      assigned_to: "ana",
    });
    const out = computeBookingWarnings([split, morning], NOW);
    expect(codes(out, split.id)).not.toContain("double_booked");
    expect(codes(out, morning.id)).not.toContain("double_booked");
  });

  it("still flags a real overlap inside someone's own segment", () => {
    const start = new Date(NOW + 48 * H).toISOString();
    const split = bk({
      client_name: "Long House",
      scheduled_at: start,
      duration_minutes: 360,
      assigned_to: "maria",
      additional_assignee_ids: ["ana"],
      assignee_segments: {
        maria: { start_offset_minutes: 0, duration_minutes: 180 },
        ana: { start_offset_minutes: 180, duration_minutes: 180 },
      },
    });
    // 1pm, squarely inside Ana's 12–3 half.
    const clash = bk({
      client_name: "Corner Cafe",
      scheduled_at: new Date(NOW + 48 * H + 4 * H).toISOString(),
      duration_minutes: 60,
      assigned_to: "ana",
    });
    const out = computeBookingWarnings([split, clash], NOW);
    expect(codes(out, split.id)).toContain("double_booked");
    expect(codes(out, clash.id)).toContain("double_booked");
  });
});

describe("overlaps that are not adjacent in time order", () => {
  it("flags a long job against a third booking it swallows", () => {
    // 8am–2pm, 9am–10am, 11am–noon. Sorted by start, the long job is only
    // adjacent to the 9am one — the noon job used to slip through.
    const day = NOW + 48 * H;
    const long = bk({
      client_name: "All Day",
      scheduled_at: new Date(day).toISOString(),
      duration_minutes: 360,
      assigned_to: "jim",
    });
    const early = bk({
      client_name: "Early",
      scheduled_at: new Date(day + H).toISOString(),
      duration_minutes: 60,
      assigned_to: "jim",
    });
    const later = bk({
      client_name: "Later",
      scheduled_at: new Date(day + 3 * H).toISOString(),
      duration_minutes: 60,
      assigned_to: "jim",
    });
    const out = computeBookingWarnings([long, early, later], NOW);
    expect(codes(out, later.id)).toContain("double_booked");
    expect(codes(out, long.id)).toContain("double_booked");
  });
});
