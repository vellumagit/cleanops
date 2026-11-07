/**
 * The cron ledger: every run leaves a row, auth refusals don't, the ledger
 * never breaks the cron, and the morning summary names what failed and what
 * has stopped running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: Array<Record<string, unknown>> = [];
let insertError: { message: string } | null = null;
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: insertError };
      },
    }),
  }),
}));

const { withCronRun, summarizeCronRuns, cronIntervalMinutes, missingAfterMinutes } = await import("@/lib/cron-run");

const req = new Request("https://sollos3.com/api/cron/x");

describe("withCronRun", () => {
  beforeEach(() => {
    inserted.length = 0;
    insertError = null;
  });

  it("records a clean run with its JSON result", async () => {
    const GET = withCronRun("/api/cron/x", async () => Response.json({ completed: 3 }));
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completed: 3 }); // the caller's body is intact
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ path: "/api/cron/x", ok: true, status: 200, error: null, result: { completed: 3 } });
  });

  it("records a thrown error as a failed run and still throws", async () => {
    const GET = withCronRun("/api/cron/x", async () => {
      throw new Error("[db-error] bookings: PGRST201");
    });
    await expect(GET(req)).rejects.toThrow(/PGRST201/);
    expect(inserted[0]).toMatchObject({ ok: false, status: null, error: "[db-error] bookings: PGRST201" });
  });

  it("records a 500 response as failed, with the body as the error", async () => {
    const GET = withCronRun("/api/cron/x", async () => Response.json({ error: "boom" }, { status: 500 }));
    const res = await GET(req);
    expect(res.status).toBe(500);
    expect(inserted[0]).toMatchObject({ ok: false, status: 500 });
    expect(String(inserted[0].error)).toContain("boom");
  });

  it("does not count an auth refusal as a run", async () => {
    for (const status of [401, 503]) {
      const GET = withCronRun("/api/cron/x", async () => Response.json({ error: "no" }, { status }));
      await GET(req);
    }
    expect(inserted).toHaveLength(0);
  });

  it("never lets the ledger break the cron", async () => {
    insertError = { message: "relation cron_runs does not exist" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const GET = withCronRun("/api/cron/x", async () => Response.json({ ok: true }));
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("cronIntervalMinutes", () => {
  it("reads the schedules vercel.json actually uses", () => {
    expect(cronIntervalMinutes("*/30 * * * *")).toBe(30);
    expect(cronIntervalMinutes("5 * * * *")).toBe(60);
    expect(cronIntervalMinutes("30 */4 * * *")).toBe(240);
    expect(cronIntervalMinutes("0 7 * * *")).toBe(1440);
    expect(cronIntervalMinutes("0 15,16 * * 5")).toBeNull(); // Fridays only
    expect(cronIntervalMinutes("0 9 1 * *")).toBeNull(); // the 1st
    expect(cronIntervalMinutes("0 18 * * 0")).toBeNull(); // Sundays
  });

  it("gives a daily cron a day plus an hour before calling it missing", () => {
    expect(missingAfterMinutes(1440)).toBe(1500);
    expect(missingAfterMinutes(30)).toBe(70);
    expect(missingAfterMinutes(240)).toBe(300);
  });
});

describe("summarizeCronRuns", () => {
  const now = Date.parse("2026-11-08T14:00:00Z"); // Sunday 8 AM Edmonton
  const since = now - 36 * 3_600_000;
  const fmt = (iso: string) => iso.slice(5, 16);
  const run = (path: string, iso: string, ok = true, error: string | null = null) => ({
    path,
    started_at: iso,
    finished_at: iso,
    ok,
    status: ok ? 200 : 500,
    error,
  });
  const crons = [
    { path: "/api/cron/billing-cycle", schedule: "0 7 * * *" },
    { path: "/api/cron/shift-reminders", schedule: "*/30 * * * *" },
    { path: "/api/cron/org-calendar-reconcile", schedule: "45 4 * * *" },
    { path: "/api/cron/compute-bonuses", schedule: "0 8 * * 1" },
  ];

  it("names a failed run and a cron that has stopped running, and counts the clean ones", () => {
    const runs = [
      run("/api/cron/billing-cycle", "2026-11-08T07:00:00Z"),
      run("/api/cron/shift-reminders", "2026-11-08T13:30:00Z"),
      run("/api/cron/shift-reminders", "2026-11-08T13:00:00Z", false, "[db-error] bookings: connection reset"),
      // The reconcile last succeeded three nights ago.
      run("/api/cron/org-calendar-reconcile", "2026-11-05T04:45:00Z"),
    ];
    const s = summarizeCronRuns(crons, runs, { nowMs: now, sinceMs: since, fmt });
    expect(s.failed).toBe(1);
    expect(s.missing).toBe(1);
    expect(s.lines[0]).toBe("6. CRONS (last 36h): 4 scheduled · 1 ran clean · 1 failed run(s) · 1 not running");
    expect(s.lines.find((l) => l.includes("FAILED"))).toContain("shift-reminders");
    expect(s.lines.find((l) => l.includes("MISSING"))).toMatch(/org-calendar-reconcile.*11-05T04:45.*expected daily/);
  });

  it("does not call a weekly cron missing, and a cron with no rows at all is missing", () => {
    const s = summarizeCronRuns(crons, [run("/api/cron/billing-cycle", "2026-11-08T07:00:00Z"), run("/api/cron/shift-reminders", "2026-11-08T13:30:00Z")], { nowMs: now, sinceMs: since, fmt });
    const missingLines = s.lines.filter((l) => l.includes("MISSING"));
    expect(missingLines).toHaveLength(1);
    expect(missingLines[0]).toContain("org-calendar-reconcile");
    expect(missingLines[0]).toContain("never");
    expect(s.lines.join("\n")).not.toMatch(/MISSING.*compute-bonuses/);
  });

  it("a half-hourly cron is missing after 70 minutes, not 31", () => {
    const at = (m: number) => new Date(now - m * 60_000).toISOString();
    const ok31 = summarizeCronRuns(crons.slice(1, 2), [run("/api/cron/shift-reminders", at(31))], { nowMs: now, sinceMs: since, fmt });
    const gone71 = summarizeCronRuns(crons.slice(1, 2), [run("/api/cron/shift-reminders", at(71))], { nowMs: now, sinceMs: since, fmt });
    expect(ok31.missing).toBe(0);
    expect(gone71.missing).toBe(1);
  });
});
