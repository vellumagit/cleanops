import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_WITHIN_DAYS,
  findMismatches,
  mismatchLines,
  type MismatchSeries,
  type MismatchVisit,
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
    expect(lines).toHaveLength(4);
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
