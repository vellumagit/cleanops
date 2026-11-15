import { describe, expect, it } from "vitest";
import {
  DOUBLE_BOOKED_WITHIN_DAYS,
  UNASSIGNED_WITHIN_DAYS,
  findDoubleBookings,
  findMismatches,
  mismatchLines,
  type MismatchSeries,
  type MismatchVisit,
  type TimedVisit,
} from "./mismatch-check";

const NOW = Date.parse("2026-11-14T15:00:00Z");
const DAY = 86_400_000;
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();
const olha = { name: "Olha Musnytska", active: true };
const olga = { name: "Olga Musnytska", active: false };

const visit = (over: Partial<MismatchVisit> = {}): MismatchVisit => ({
  id: "v1",
  scheduled_at: inDays(3),
  client: "Hilda Daubner",
  address: "6315 135 Avenue NW",
  sourceAddress: "6315 135 Avenue NW",
  crew: [olha],
  covered: false,
  ...over,
});

describe("findMismatches", () => {
  it("a visit that agrees with its client is nothing to report", () => {
    expect(findMismatches([visit()], [], NOW)).toEqual([]);
  });

  it("Hilda: the visit kept the old address after the client's changed", () => {
    const found = findMismatches([visit({ address: "13825 155 Avenue NW" })], [], NOW);
    expect(found.map((m) => m.kind)).toEqual(["address"]);
    expect(found[0].client).toBe("Hilda Daubner");
  });

  it("the same address written two ways is not a mismatch", () => {
    expect(
      findMismatches([visit({ address: "9420 58 St NW", sourceAddress: "9420 58 Street Northwest, Edmonton, AB" })], [], NOW),
    ).toEqual([]);
  });

  it("a visit with no address of its own follows the client and is fine", () => {
    expect(findMismatches([visit({ address: null })], [], NOW)).toEqual([]);
    expect(findMismatches([visit({ sourceAddress: null })], [], NOW)).toEqual([]);
  });

  it("Nancy Ellestad: a deactivated cleaner is still on the visit, and on the series", () => {
    const series: MismatchSeries[] = [{ id: "s1", client: "Nancy Ellestad", crew: [olga] }];
    const found = findMismatches([visit({ client: "Nancy Ellestad", crew: [olga, olha] })], series, NOW);
    expect(found.map((m) => m.kind).sort()).toEqual(["inactive_crew", "series_inactive_crew"]);
    expect(found.every((m) => m.detail === "Olga Musnytska")).toBe(true);
  });

  it("nobody on a visit matters when it is close, not when it is months out", () => {
    const soon = visit({ id: "soon", crew: [], scheduled_at: inDays(UNASSIGNED_WITHIN_DAYS - 1) });
    const far = visit({ id: "far", crew: [], scheduled_at: inDays(UNASSIGNED_WITHIN_DAYS + 30) });
    expect(findMismatches([soon, far], [], NOW).map((m) => m.id)).toEqual(["soon"]);
  });

  it("a visit a subcontractor has claimed is staffed", () => {
    expect(findMismatches([visit({ crew: [], covered: true })], [], NOW)).toEqual([]);
  });
});

describe("mismatchLines", () => {
  const fmt = (iso: string) => iso.slice(0, 10);

  it("always prints every kind with its count, so a clean day reads as zeros", () => {
    const lines = mismatchLines([], fmt);
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => /^\s+0\s/.test(l))).toBe(true);
  });

  it("a whole series with one problem is one line with the range", () => {
    const visits = Array.from({ length: 52 }, (_, i) =>
      visit({ id: `n${i}`, client: "Nancy Ellestad", crew: [olga], scheduled_at: inDays(16 + i * 14) }),
    );
    const lines = mismatchLines(findMismatches(visits, [], NOW), fmt);
    const about = lines.filter((l) => l.includes("Nancy Ellestad"));
    expect(about).toHaveLength(1);
    expect(about[0]).toContain("52 visits");
    expect(about[0]).toContain("Olga Musnytska");
    expect(lines.find((l) => l.includes("someone on the crew is deactivated"))).toMatch(/\b52\b/);
  });

  it("past the limit, says how many more clients", () => {
    const visits = Array.from({ length: 12 }, (_, i) =>
      visit({ id: `c${i}`, client: `Client ${i}`, address: "1 Other Road" }),
    );
    const lines = mismatchLines(findMismatches(visits, [], NOW), fmt, 8);
    expect(lines.some((l) => l.includes("and 4 more client(s)"))).toBe(true);
  });
});

describe("findDoubleBookings", () => {
  const names: Record<string, string> = { olha: "Olha Musnytska", vira: "Vira Karpynska" };
  const nameOfMember = (id: string) => names[id] ?? "?";
  const at = (days: number, hour: number) => new Date(NOW + days * DAY + hour * 3_600_000).toISOString();
  const job = (over: Partial<TimedVisit> & { bookingId: string; client: string }): TimedVisit => ({
    scheduledAt: at(3, 0),
    durationMinutes: 240,
    dividesHours: false,
    crew: [{ membershipId: "olha" }],
    ...over,
  });

  it("one person on two jobs at overlapping times is one finding naming her and both clients", () => {
    const found = findDoubleBookings(
      [
        job({ bookingId: "a", client: "Leslie Saumer", durationMinutes: 300 }),
        job({ bookingId: "b", client: "Amanda SJ", scheduledAt: at(3, 1) }),
      ],
      nameOfMember,
      NOW,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "double_booked", client: "Olha Musnytska: Leslie Saumer and Amanda SJ", when: at(3, 1) });
  });

  it("back-to-back jobs, and two different people at the same time, are not double-bookings", () => {
    const found = findDoubleBookings(
      [
        job({ bookingId: "a", client: "First" }),
        job({ bookingId: "b", client: "Second", scheduledAt: at(3, 4) }),
        job({ bookingId: "c", client: "Third", crew: [{ membershipId: "vira" }] }),
      ],
      nameOfMember,
      NOW,
    );
    expect(found).toEqual([]);
  });

  it("shared hours shorten each person's time: 8 hours for two ends at noon, so a 1 PM job is clear and a 10:30 one is not", () => {
    const big = job({
      bookingId: "big",
      client: "Raheem Dhanani",
      durationMinutes: 480,
      dividesHours: true,
      crew: [{ membershipId: "olha" }, { membershipId: "vira" }],
    });
    expect(findDoubleBookings([big, job({ bookingId: "pm", client: "After", scheduledAt: at(3, 4) })], nameOfMember, NOW)).toEqual([]);
    const clash = findDoubleBookings([big, job({ bookingId: "mid", client: "Promotional Wearhouse", scheduledAt: at(3, 1.5) })], nameOfMember, NOW);
    expect(clash.map((m) => m.client)).toEqual(["Olha Musnytska: Raheem Dhanani and Promotional Wearhouse"]);
  });

  it("a person's own segment is the time that counts", () => {
    const split = job({
      bookingId: "split",
      client: "Split Shift",
      durationMinutes: 480,
      crew: [
        { membershipId: "vira", startOffsetMinutes: 0, durationMinutes: 240 },
        { membershipId: "olha", startOffsetMinutes: 240, durationMinutes: 240 },
      ],
    });
    // Olha's part starts four hours in; a two-hour job at the start is clear.
    expect(findDoubleBookings([split, job({ bookingId: "early", client: "Early", durationMinutes: 120 })], nameOfMember, NOW)).toEqual([]);
    expect(findDoubleBookings([split, job({ bookingId: "late", client: "Late", scheduledAt: at(3, 5) })], nameOfMember, NOW)).toHaveLength(1);
  });

  it("only within the horizon", () => {
    const far = DOUBLE_BOOKED_WITHIN_DAYS + 2;
    const found = findDoubleBookings(
      [job({ bookingId: "a", client: "A", scheduledAt: at(far, 0) }), job({ bookingId: "b", client: "B", scheduledAt: at(far, 1) })],
      nameOfMember,
      NOW,
    );
    expect(found).toEqual([]);
  });

  it("prints as its own line in the report", () => {
    const found = findDoubleBookings(
      [job({ bookingId: "a", client: "Leslie Saumer" }), job({ bookingId: "b", client: "Amanda SJ", scheduledAt: at(3, 1) })],
      nameOfMember,
      NOW,
    );
    const lines = mismatchLines(found, (iso) => iso.slice(0, 10));
    expect(lines.some((l) => l.includes(" 1  one person on two jobs at once"))).toBe(true);
    expect(lines.some((l) => l.includes("Olha Musnytska: Leslie Saumer and Amanda SJ " + at(3, 1).slice(0, 10)))).toBe(true);
  });
});
