import { describe, it, expect } from "vitest";
import {
  clientBookingActions,
  occurrenceDate,
  SKIP_AUTO_APPLY_HOURS,
} from "./client-job-requests";

const NOW = new Date("2026-08-06T18:00:00Z").getTime();
const at = (hoursFromNow: number) =>
  new Date(NOW + hoursFromNow * 3_600_000).toISOString();

const upcoming = (over: Record<string, unknown> = {}) => ({
  scheduled_at: at(72),
  status: "confirmed",
  archived_at: null,
  ...over,
});

describe("what a client may do to a visit", () => {
  it("allows both on a normal upcoming job", () => {
    const s = clientBookingActions(upcoming(), NOW);
    expect(s.canNote).toBe(true);
    expect(s.canSkip).toBe(true);
    expect(s.reason).toBeNull();
  });

  it("allows them on a pending job too — it is still going to happen", () => {
    expect(
      clientBookingActions(upcoming({ status: "pending" }), NOW).canNote,
    ).toBe(true);
  });

  it("refuses once the cleaner has started, and says to call", () => {
    // The one case where a portal request is actively worse than a phone
    // call: somebody is in the house and a queued note will not reach them.
    const s = clientBookingActions(upcoming({ status: "in_progress" }), NOW);
    expect(s.canNote).toBe(false);
    expect(s.canSkip).toBe(false);
    expect(s.reason).toMatch(/already started/i);
  });

  it("refuses on finished, cancelled and archived visits", () => {
    for (const over of [
      { status: "completed" },
      { status: "cancelled" },
      { archived_at: "2026-08-01T00:00:00Z" },
    ]) {
      const s = clientBookingActions(upcoming(over), NOW);
      expect(s.canNote).toBe(false);
      expect(s.canSkip).toBe(false);
      expect(s.reason).not.toBeNull();
    }
  });

  it("refuses on a visit whose time has passed", () => {
    expect(
      clientBookingActions(upcoming({ scheduled_at: at(-1) }), NOW).canSkip,
    ).toBe(false);
  });

  it("does not throw on an unparseable date", () => {
    const s = clientBookingActions(upcoming({ scheduled_at: "nonsense" }), NOW);
    expect(s.canSkip).toBe(false);
  });
});

describe("the skip auto-apply window", () => {
  it("applies immediately when there is still time to react", () => {
    for (const h of [SKIP_AUTO_APPLY_HOURS, 72, 24 * 14]) {
      expect(
        clientBookingActions(upcoming({ scheduled_at: at(h) }), NOW)
          .skipAutoApplies,
      ).toBe(true);
    }
  });

  it("queues for a human once the crew is committed", () => {
    // Inside the window the slot is hard to refill and someone may already be
    // scheduled, so this becomes a request rather than a cancellation.
    for (const h of [SKIP_AUTO_APPLY_HOURS - 0.5, 12, 2, 0.5]) {
      const s = clientBookingActions(upcoming({ scheduled_at: at(h) }), NOW);
      expect(s.canSkip).toBe(true);
      expect(s.skipAutoApplies).toBe(false);
    }
  });

  it("treats the boundary itself as auto-applying", () => {
    expect(
      clientBookingActions(
        upcoming({ scheduled_at: at(SKIP_AUTO_APPLY_HOURS) }),
        NOW,
      ).skipAutoApplies,
    ).toBe(true);
  });
});

describe("occurrenceDate", () => {
  it("uses the org's calendar day, not UTC's", () => {
    // 01:00 UTC on Aug 7 is still Aug 6 in Edmonton. Slicing the ISO string
    // would store Aug 7, never match booking_series.skip_dates, and the
    // nightly cron would keep regenerating the skipped visit — a bug this
    // codebase has already had once.
    const evening = "2026-08-07T01:00:00Z";
    expect(occurrenceDate(evening, "America/Edmonton")).toBe("2026-08-06");
    expect(evening.slice(0, 10)).toBe("2026-08-07");
  });

  it("agrees with UTC when the org is on UTC", () => {
    expect(occurrenceDate("2026-08-07T01:00:00Z", "UTC")).toBe("2026-08-07");
  });
});
