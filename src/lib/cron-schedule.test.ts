import { describe, expect, it } from "vitest";
import { exportsGet, routeFileFor, scheduleProblem } from "./cron-schedule";

describe("scheduleProblem", () => {
  it("accepts every shape vercel.json uses today, sub-daily included", () => {
    for (const s of [
      "0 8 * * *",
      "5 * * * *",
      "0 8 * * 1",
      "0 9 1 * *",
      "0 15,16 * * 5",
      "*/30 * * * *",
      "30 */4 * * *",
      "0 9-17/2 * * 1-5",
    ]) {
      expect(scheduleProblem(s), s).toBeNull();
    }
  });
  it("rejects the wrong number of fields", () => {
    expect(scheduleProblem("0 8 * *")).toMatch(/5 fields/);
    expect(scheduleProblem("0 0 8 * * *")).toMatch(/5 fields/);
  });
  it("rejects values out of range", () => {
    expect(scheduleProblem("60 * * * *")).toMatch(/minute/);
    expect(scheduleProblem("0 24 * * *")).toMatch(/hour/);
    expect(scheduleProblem("0 0 0 * *")).toMatch(/day of month/);
    expect(scheduleProblem("0 0 * 13 *")).toMatch(/month/);
    expect(scheduleProblem("0 0 * * 7")).toMatch(/day of week/);
  });
  it("rejects names, which Vercel does not support", () => {
    expect(scheduleProblem("0 8 * * MON")).toMatch(/day of week/);
    expect(scheduleProblem("0 8 1 JAN *")).toMatch(/month/);
  });
  it("rejects malformed steps and ranges", () => {
    expect(scheduleProblem("*/0 * * * *")).toMatch(/step/);
    expect(scheduleProblem("5/10 * * * *")).toMatch(/step needs/);
    expect(scheduleProblem("0 17-9 * * *")).toMatch(/backwards/);
    expect(scheduleProblem("0 1-2-3 * * *")).toMatch(/'-'/);
    expect(scheduleProblem("0 ,8 * * *")).toMatch(/hour/);
  });
  it("rejects day of month and day of week set together", () => {
    expect(scheduleProblem("0 8 1 * 1")).toMatch(/both set/);
  });
});

describe("routeFileFor", () => {
  it("maps a cron path to its route file, ignoring a query string", () => {
    expect(routeFileFor("/api/cron/cleanup")).toBe("src/app/api/cron/cleanup/route.ts");
    expect(routeFileFor("/api/cron/cleanup?dry=1")).toBe("src/app/api/cron/cleanup/route.ts");
  });
  it("refuses a path without a leading slash", () => {
    expect(routeFileFor("api/cron/cleanup")).toBeNull();
  });
});

describe("exportsGet", () => {
  it("finds the forms a handler can take", () => {
    expect(exportsGet("export async function GET(request: Request) {")).toBe(true);
    expect(exportsGet("export function GET() {")).toBe(true);
    expect(exportsGet("export const GET = withCronAuth(run);")).toBe(true);
    expect(exportsGet("export { handler as GET, handler as POST };")).toBe(true);
  });
  it("misses a POST-only route", () => {
    expect(exportsGet("export async function POST(request: Request) {")).toBe(false);
  });
});
