/**
 * What each kind of person can see and do, asked of the real policies.
 *
 * Two companies, so that every "sees her own" has a "and not theirs" beside
 * it. Statements run the way PostgREST would run them for that person's JWT
 * (see harness.ts), so a policy that is too wide or too narrow shows up here
 * and not in production.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addBooking,
  addClient,
  addCrew,
  addMember,
  addOrg,
  openDb,
  refusal,
  scenario,
  type Member,
  type World,
} from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

type Cast = {
  orgA: string;
  orgB: string;
  owner: Member;
  manager: Member;
  anna: Member; // cleaner, on the job
  bea: Member; // cleaner, same company, not on the job
  outsider: Member; // cleaner at the other company
  annasJob: string;
  otherJob: string; // company A, nobody from the cast on it
  theirJob: string; // company B
};

const count = async (sql: World["seed"], table: string): Promise<number> =>
  (await sql<{ n: number }>(`select count(*)::int as n from public.${table}`))[0].n;

async function cast(w: World): Promise<Cast> {
  const orgA = await addOrg(w.seed, "Company A");
  const orgB = await addOrg(w.seed, "Company B");
  const owner = await addMember(w.seed, orgA, "owner");
  const manager = await addMember(w.seed, orgA, "manager");
  const anna = await addMember(w.seed, orgA, "employee", "Anna");
  const bea = await addMember(w.seed, orgA, "employee", "Bea");
  await addMember(w.seed, orgB, "owner");
  const outsider = await addMember(w.seed, orgB, "employee", "Outsider");

  const clientA = await addClient(w.seed, orgA);
  const clientB = await addClient(w.seed, orgB);
  const annasJob = await addBooking(w.seed, orgA, clientA, { scheduledAt: "2031-03-03T16:00:00Z" });
  const otherJob = await addBooking(w.seed, orgA, clientA, { scheduledAt: "2031-03-04T16:00:00Z" });
  const theirJob = await addBooking(w.seed, orgB, clientB, { scheduledAt: "2031-03-03T16:00:00Z" });
  await addCrew(w.seed, orgA, annasJob, anna.membershipId);

  // One finished shift each for Anna and Bea, and one at the other company.
  for (const [org, who, job] of [
    [orgA, anna, annasJob],
    [orgA, bea, null],
    [orgB, outsider, theirJob],
  ] as const) {
    await w.seed(
      `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at)
       values ($1, $2, $3, '2031-03-01T15:00:00Z', '2031-03-01T17:00:00Z')`,
      [org, who.membershipId, job],
    );
  }
  return { orgA, orgB, owner, manager, anna, bea, outsider, annasJob, otherJob, theirJob };
}

describe("between companies", () => {
  it("a cleaner sees her own company's work and none of another's", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const anna = w.as(c.anna.userId);
      expect(await count(anna, "organizations")).toBe(1);
      expect(await count(anna, "bookings")).toBe(2);
      expect(await count(anna, "clients")).toBe(1);
      expect(await count(anna, "memberships")).toBe(4);
      expect(await count(anna, "booking_assignees")).toBe(1);
      const seen = await anna<{ organization_id: string }>(
        "select distinct organization_id from public.bookings",
      );
      expect(seen.map((r) => r.organization_id)).toEqual([c.orgA]);
      // Asking for the other company's job by id finds nothing either.
      expect(await anna("select id from public.bookings where id = $1", [c.theirJob])).toEqual([]);
    }));

  it("someone with no session sees nothing", () =>
    scenario(db, async (w) => {
      await cast(w);
      for (const table of ["organizations", "bookings", "clients", "memberships", "time_entries", "booking_assignees"]) {
        expect(await count(w.anon, table), table).toBe(0);
      }
    }));

  it("a member who has been switched off sees nothing", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const gone = await addMember(w.seed, c.orgA, "employee", "Gone", "disabled");
      const sql = w.as(gone.userId);
      expect(await count(sql, "bookings")).toBe(0);
      expect(await count(sql, "clients")).toBe(0);
      expect(await count(sql, "organizations")).toBe(0);
    }));

  it("a signed-in user of one company cannot write into another", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const outsider = w.as(c.outsider.userId);
      // Updates the policy hides simply match no row.
      const touched = await outsider(
        "update public.bookings set notes = 'mine now' where id = $1 returning id",
        [c.annasJob],
      );
      expect(touched).toEqual([]);
      expect(
        await refusal(
          outsider("insert into public.clients (organization_id, name) values ($1, 'planted')", [c.orgA]),
        ),
      ).toBe("42501");
    }));
});

describe("inside a company", () => {
  /**
   * The reason decisions about OTHER people read through the admin client:
   * through her own client a cleaner cannot see whether a teammate is still
   * on the clock, so "is anyone still working?" asked that way always says
   * no. Slice 2 of the finish plan moved those reads; this pins why.
   */
  it("a cleaner sees her own shifts and never a teammate's; a manager sees them all", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const annas = await w.as(c.anna.userId)<{ employee_id: string }>(
        "select employee_id from public.time_entries",
      );
      expect(annas.map((r) => r.employee_id)).toEqual([c.anna.membershipId]);
      expect(await count(w.as(c.manager.userId), "time_entries")).toBe(2);
      expect(await count(w.service, "time_entries")).toBe(3);
    }));

  it("a cleaner cannot clock in as someone else", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      expect(
        await refusal(
          w.as(c.anna.userId)(
            "insert into public.time_entries (organization_id, employee_id, clock_in_at) values ($1, $2, now())",
            [c.orgA, c.bea.membershipId],
          ),
        ),
      ).toBe("42501");
    }));

  /**
   * time_entries_employee_insert_guard. The phone's tap time is not kept
   * for a cleaner: the server's clock is. That is deliberate against a
   * back-dated clock-in, and it is also the open item "clock-ins never carry
   * the phone's tap time" on the half-shipped list. Whichever way that is
   * decided, it is decided here.
   */
  it("a cleaner's clock-in takes the server's time and cannot arrive already finished", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const [row] = await w.as(c.anna.userId)<{ on_server_clock: boolean; clock_out_at: string | null }>(
        `insert into public.time_entries (organization_id, employee_id, booking_id, clock_in_at, clock_out_at)
         values ($1, $2, $3, '2020-01-01T08:00:00Z', '2020-01-01T16:00:00Z')
         returning clock_in_at = now() as on_server_clock, clock_out_at`,
        [c.orgA, c.anna.membershipId, c.annasJob],
      );
      expect(row.on_server_clock).toBe(true);
      expect(row.clock_out_at).toBeNull();
    }));

  it("a manager's entry keeps the times she typed", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const [row] = await w.as(c.manager.userId)<{ kept: boolean }>(
        `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at)
         values ($1, $2, '2031-03-02T15:00:00Z', '2031-03-02T18:00:00Z')
         returning (clock_in_at = '2031-03-02T15:00:00Z' and clock_out_at = '2031-03-02T18:00:00Z') as kept`,
        [c.orgA, c.bea.membershipId],
      );
      expect(row.kept).toBe(true);
    }));

  it("a cleaner can update the job she is on, and not one she isn't", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const anna = w.as(c.anna.userId);
      const hers = await anna("update public.bookings set notes = 'gate code 4411' where id = $1 returning id", [
        c.annasJob,
      ]);
      expect(hers).toHaveLength(1);
      const notHers = await anna("update public.bookings set notes = 'x' where id = $1 returning id", [
        c.otherJob,
      ]);
      expect(notHers).toEqual([]);
    }));

  it("a cleaner cannot create or delete jobs; a manager can", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const [client] = await w.seed<{ id: string }>(
        "select id from public.clients where organization_id = $1",
        [c.orgA],
      );
      const insert = `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type)
                      values ($1, $2, '2031-04-01T16:00:00Z', 90, 'standard') returning id`;
      expect(await refusal(w.as(c.anna.userId)(insert, [c.orgA, client.id]))).toBe("42501");
      expect(await w.as(c.anna.userId)("delete from public.bookings where id = $1 returning id", [c.otherJob])).toEqual([]);
      expect(await w.as(c.manager.userId)(insert, [c.orgA, client.id])).toHaveLength(1);
    }));
});

describe("functions closed to the public key (migration 20261110010000)", () => {
  it("no caller, signed in or not, can run up another company's email count", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const bump = "select public.bump_org_email_counter($1, current_date)";
      expect(await refusal(w.anon(bump, [c.orgA]))).toBe("42501");
      expect(await refusal(w.as(c.outsider.userId)(bump, [c.orgA]))).toBe("42501");
      expect(await refusal(w.as(c.owner.userId)(bump, [c.orgA]))).toBe("42501");
      // The app's own path: email.ts calls it through the admin client.
      const [row] = await w.service<{ sent: number }>(
        "select public.bump_org_email_counter($1, current_date) as sent",
        [c.orgA],
      );
      expect(row.sent).toBe(1);
    }));

  it("the schedule internals answer nobody directly", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const outsider = w.as(c.outsider.userId);
      expect(await refusal(outsider("select public.booking_shares_hours(false, $1)", [c.orgA]))).toBe("42501");
      expect(
        await refusal(outsider("select public.booking_schedule_conflicts($1, null, '[]'::jsonb)", [c.orgA])),
      ).toBe("42501");
      expect(
        await refusal(outsider("select public.booking_schedule_windows_conflict($1, null, '[]'::jsonb)", [c.orgA])),
      ).toBe("42501");
      expect(await refusal(outsider("select public.ensure_general_thread($1)", [c.orgA]))).toBe("42501");
      expect(await refusal(w.anon("select public.lock_booking_schedule_writes($1)", [c.orgA]))).toBe("42501");
    }));

  it("the conflict check is open to an owner of that company and to nobody else", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const check = "select public.booking_schedule_has_conflict($1, null, '[]'::jsonb) as hit";
      expect(await w.as(c.owner.userId)<{ hit: boolean }>(check, [c.orgA])).toEqual([{ hit: false }]);
      expect(await refusal(w.as(c.anna.userId)(check, [c.orgA]))).toBe("42501");
      expect(await refusal(w.as(c.outsider.userId)(check, [c.orgA]))).toBe("42501");
      expect(await refusal(w.anon(check, [c.orgA]))).toBe("42501");
    }));

  /**
   * The point of the lock-down is that nothing the app does needed those
   * grants. Scheduling as a manager walks every trigger that calls the
   * now-internal functions: the write lock, the member windows, the conflict
   * search, and the general-thread check when a member is added.
   */
  it("a manager can still schedule, move and staff a job, and add a member", () =>
    scenario(db, async (w) => {
      const c = await cast(w);
      const manager = w.as(c.manager.userId);
      const [client] = await w.seed<{ id: string }>(
        "select id from public.clients where organization_id = $1",
        [c.orgA],
      );
      const [job] = await manager<{ id: string }>(
        `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status)
         values ($1, $2, '2031-05-05T16:00:00Z', 120, 'standard', 'confirmed') returning id`,
        [c.orgA, client.id],
      );
      await manager(
        "insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)",
        [c.orgA, job.id, c.bea.membershipId],
      );
      const moved = await manager(
        "update public.bookings set scheduled_at = '2031-05-05T18:00:00Z' where id = $1 returning id",
        [job.id],
      );
      expect(moved).toHaveLength(1);

      const [user] = await w.seed<{ id: string }>(
        "insert into auth.users (email) values ('new.hire@example.test') returning id",
      );
      const hired = await w.as(c.owner.userId)(
        "insert into public.memberships (organization_id, profile_id, role) values ($1, $2, 'employee') returning id",
        [c.orgA, user.id],
      );
      expect(hired).toHaveLength(1);
    }));
});
