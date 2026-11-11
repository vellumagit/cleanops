/**
 * Rules that exist twice: once in SQL for the database's own guards, once in
 * TypeScript for the app. Nothing forces two copies to agree, and a guard that
 * measures a job differently from the screen refuses what the screen allowed.
 *
 * Each test asks the real SQL function and the real TypeScript function the
 * same question over a grid of cases and requires one answer.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAutomationEnabled } from "@/lib/automation-defaults";
import { jobWindowEndMs, type JobStateCrewRow } from "@/lib/job-state";
import {
  addBooking,
  addClient,
  addMember,
  addOrg,
  openDb,
  scenario,
} from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("does this job divide its hours across the crew?", () => {
  /**
   * SQL: booking_shares_hours(row flag, org).
   * TypeScript, everywhere: row flag === true || the org's divide_crew_hours.
   *
   * The master automations switch is in the grid on purpose. Until
   * 2026-11-10 the SQL required it and the TypeScript did not, so pausing
   * automations made the overlap guard measure team jobs at full length.
   */
  it("the overlap guard and the app give the same answer in every state", () =>
    scenario(db, async (w) => {
      // automation_settings is NOT NULL, so an empty object is the least it can be.
      const settingsCases: Array<Record<string, { enabled?: boolean }>> = [
        {},
        { divide_crew_hours: {} },
        { divide_crew_hours: { enabled: false } },
        { divide_crew_hours: { enabled: true } },
        { some_other_automation: { enabled: true } },
      ];
      const disagreements: string[] = [];
      for (const master of [true, false]) {
        for (const settings of settingsCases) {
          const org = await addOrg(w.seed);
          await w.seed(
            "update public.organizations set automations_enabled = $2, automation_settings = $3::jsonb where id = $1",
            [org, master, JSON.stringify(settings)],
          );
          for (const flag of [true, false, null]) {
            const [row] = await w.service<{ shares: boolean }>(
              "select public.booking_shares_hours($1, $2) as shares",
              [flag, org],
            );
            const app = flag === true || resolveAutomationEnabled(settings, "divide_crew_hours");
            if (row.shares !== app) {
              disagreements.push(
                `master=${master} settings=${JSON.stringify(settings)} row=${flag}: sql=${row.shares} app=${app}`,
              );
            }
          }
        }
      }
      expect(disagreements).toEqual([]);
    }));
});

describe("when is the job over?", () => {
  type Seg = { offset: number | null; duration: number | null };

  /**
   * SQL: booking_member_windows gives each person's window; the job is over
   * at the latest end. TypeScript: jobWindowEndMs.
   *
   * Left out on purpose: a segment with a length and no start. Those were
   * saved before 2026-10-02 and their order is unknown, so each side makes
   * its own safe guess (the app waits the full hours, the guard starts
   * everyone at the beginning). They are not the same question there.
   */
  const cases: Array<{ name: string; minutes: number; divides: boolean; crew: Seg[] }> = [];
  const plain: Seg = { offset: null, duration: null };
  for (const divides of [false, true]) {
    for (const minutes of [45, 90, 240, 1080]) {
      for (const size of [1, 2, 3, 4]) {
        cases.push({
          name: `${size} on a ${minutes}-minute job, ${divides ? "divided" : "not divided"}`,
          minutes,
          divides,
          crew: Array.from({ length: size }, () => plain),
        });
      }
    }
    cases.push({
      name: `hand-off: two back-to-back segments, ${divides ? "divided" : "not divided"}`,
      minutes: 480,
      divides,
      crew: [
        { offset: 0, duration: 240 },
        { offset: 240, duration: 240 },
      ],
    });
    cases.push({
      name: `one late segment beside a plain crew member, ${divides ? "divided" : "not divided"}`,
      minutes: 240,
      divides,
      crew: [plain, { offset: 180, duration: 180 }],
    });
    cases.push({
      name: `a segment that ends before the shared hours do, ${divides ? "divided" : "not divided"}`,
      minutes: 600,
      divides,
      crew: [plain, plain, { offset: 0, duration: 60 }],
    });
  }

  it("the guard's windows and the app's window end at the same minute", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const client = await addClient(w.seed, org);
      const start = "2031-06-02T15:00:00.000Z";
      const disagreements: string[] = [];

      for (const c of cases) {
        const job = await addBooking(w.seed, org, client, {
          scheduledAt: start,
          durationMinutes: c.minutes,
        });
        const crew: JobStateCrewRow[] = [];
        for (const seg of c.crew) {
          // A fresh person each time, so one case never overlaps another's crew.
          const m = await addMember(w.seed, org, "employee");
          await w.seed(
            `insert into public.booking_assignees
               (organization_id, booking_id, membership_id, split_start_offset_minutes, split_duration_minutes)
             values ($1, $2, $3, $4, $5)`,
            [org, job, m.membershipId, seg.offset, seg.duration],
          );
          crew.push({
            membership_id: m.membershipId,
            split_start_offset_minutes: seg.offset,
            split_duration_minutes: seg.duration,
          } as JobStateCrewRow);
        }

        const [row] = await w.service<{ last_end: string | null }>(
          `select max((win ->> 'end_at')::timestamptz) as last_end
           from jsonb_array_elements(
             public.booking_member_windows($1, $2, $3::timestamptz, $4, null, null, $5, null)
           ) win`,
          [job, org, start, c.minutes, c.divides],
        );
        const sqlEnd = row.last_end ? new Date(row.last_end).getTime() : null;
        const appEnd = jobWindowEndMs(
          { scheduled_at: start, duration_minutes: c.minutes, divides_hours: c.divides },
          crew,
        );
        if (sqlEnd !== appEnd) {
          const mins = (ms: number | null) => (ms == null ? "none" : `${(ms - new Date(start).getTime()) / 60_000} min`);
          disagreements.push(`${c.name}: sql ends at ${mins(sqlEnd)}, app at ${mins(appEnd)}`);
        }
      }
      expect(cases.length).toBeGreaterThan(30);
      expect(disagreements).toEqual([]);
    }), 60_000);
});
