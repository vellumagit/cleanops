import { describe, it, expect } from "vitest";
import {
  instantForWallClock,
  normalizeWallClock,
  planRederive,
  scheduleFromWallClock,
  wallClockForInstant,
} from "./scheduled-local";

// Regina is UTC-6 on every tzdata, so these say the same thing on a laptop
// with old Alberta rules and on the server with new ones.
const TZ = "America/Regina";

describe("wall clock <-> instant", () => {
  it("round-trips a typed time", () => {
    expect(instantForWallClock("2026-12-07T09:00", TZ)).toBe("2026-12-07T15:00:00.000Z");
    expect(wallClockForInstant("2026-12-07T15:00:00Z", TZ)).toBe("2026-12-07T09:00");
    expect(scheduleFromWallClock("2026-12-07T09:00", TZ)).toEqual({
      scheduled_at: "2026-12-07T15:00:00.000Z",
      scheduled_local: "2026-12-07T09:00",
      scheduled_tz: TZ,
    });
  });
  it("follows daylight saving where a zone has it", () => {
    expect(instantForWallClock("2026-07-06T09:00", "America/Toronto")).toBe("2026-07-06T13:00:00.000Z");
    expect(instantForWallClock("2026-12-07T09:00", "America/Toronto")).toBe("2026-12-07T14:00:00.000Z");
  });
  it("normalizes what a datetime-local input or Postgres hands back", () => {
    expect(normalizeWallClock("2026-12-07T09:00")).toBe("2026-12-07T09:00");
    expect(normalizeWallClock("2026-12-07T09:00:00")).toBe("2026-12-07T09:00");
    expect(normalizeWallClock(" 2026-12-07T09:00 ")).toBe("2026-12-07T09:00");
    expect(normalizeWallClock("tomorrow")).toBeNull();
    expect(normalizeWallClock(null)).toBeNull();
  });
});

describe("planRederive — the nightly self-correction", () => {
  const NOW = Date.parse("2026-10-28T18:00:00Z");
  const row = (id: string, at: string, local: string | null = "2026-12-07T09:00", tz: string | null = TZ) => ({
    id,
    scheduled_at: at,
    scheduled_local: local,
    scheduled_tz: tz,
  });

  it("moves a visit whose instant drifted from its wall clock, and leaves one that didn't", () => {
    const { changes } = planRederive(
      [row("late", "2026-12-07T16:00:00Z"), row("ok", "2026-12-07T15:00:00Z")],
      { now: NOW, knowsZone: () => true },
    );
    expect(changes).toEqual([
      { id: "late", from: "2026-12-07T16:00:00.000Z", to: "2026-12-07T15:00:00.000Z", tz: TZ, local: "2026-12-07T09:00" },
    ]);
  });

  it("never touches the past, a row with no wall clock, or one it can't read", () => {
    const { changes } = planRederive(
      [
        row("past", "2026-10-01T16:00:00Z", "2026-10-01T09:00"),
        row("blank", "2026-12-07T16:00:00Z", null),
        row("junk", "2026-12-07T16:00:00Z", "noon-ish"),
        row("nozone", "2026-12-07T16:00:00Z", "2026-12-07T09:00", null),
      ],
      { now: NOW, knowsZone: () => true },
    );
    expect(changes).toEqual([]);
  });

  it("refuses a zone this runtime has wrong rather than move every visit onto stale rules", () => {
    const { changes, refusedZones } = planRederive(
      [row("edm", "2026-12-07T16:00:00Z", "2026-12-07T09:00", "America/Edmonton"), row("reg", "2026-12-07T16:00:00Z")],
      { now: NOW, knowsZone: (tz) => tz !== "America/Edmonton" },
    );
    expect(refusedZones).toEqual(["America/Edmonton"]);
    expect(changes.map((c) => c.id)).toEqual(["reg"]);
  });
});
