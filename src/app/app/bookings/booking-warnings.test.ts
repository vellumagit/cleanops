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
