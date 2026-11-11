/**
 * The refusals the app's error handling is written around.
 *
 * Code branches on these SQLSTATEs: 23505 is "someone already did this" (a
 * second clock-in, a webhook delivered twice, a billing period already
 * invoiced), 23P01 is "that cleaner is already booked", 23503 is "still in
 * use". Each branch is only right while the database really refuses with
 * that code. src/lib/supabase/query-guard.ts (allowDbErrors) and
 * test/expected-db-errors.test.ts cover the TypeScript half; this is the
 * database's half.
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
} from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("already done (23505)", () => {
  it("a person has one open shift at a time, whoever opens the second", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const anna = await addMember(w.seed, org, "employee", "Anna");
      const open = "insert into public.time_entries (organization_id, employee_id, clock_in_at) values ($1, $2, now())";
      await w.as(anna.userId)(open, [org, anna.membershipId]);
      // Her own second tap (field/clock and field/jobs actions expect this code)...
      expect(await refusal(w.as(anna.userId)(open, [org, anna.membershipId]))).toBe("23505");
      // ...and the office opening one for her while she is on the clock.
      expect(await refusal(w.service(open, [org, anna.membershipId]))).toBe("23505");
      // Closing the first makes room for the next.
      await w.service("update public.time_entries set clock_out_at = now() where employee_id = $1", [
        anna.membershipId,
      ]);
      await w.as(anna.userId)(open, [org, anna.membershipId]);
    }));

  it("a client has one live invoice per billing period; voiding it frees the period", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const client = await addClient(w.seed, org);
      const draft = `insert into public.invoices (organization_id, client_id, status, amount_cents, billing_period_key)
                     values ($1, $2, 'draft', 10000, 'monthly:2031-06') returning id`;
      const [first] = await w.service<{ id: string }>(draft, [org, client]);
      // The billing run's retry after a crash lands here and must not bill twice.
      expect(await refusal(w.service(draft, [org, client]))).toBe("23505");
      await w.service("update public.invoices set status = 'void', voided_at = now() where id = $1", [first.id]);
      expect(await w.service(draft, [org, client])).toHaveLength(1);
    }));

  it("a job has one live invoice of its own; voiding it frees the job", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const client = await addClient(w.seed, org);
      const job = await addBooking(w.seed, org, client, {
        scheduledAt: "2031-06-03T15:00:00Z",
        status: "confirmed",
      });
      const invoice = `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
                       values ($1, $2, $3, 'draft', 14000) returning id`;
      const [first] = await w.service<{ id: string }>(invoice, [org, client, job]);
      expect(await refusal(w.service(invoice, [org, client, job]))).toBe("23505");
      await w.service("update public.invoices set status = 'void', voided_at = now() where id = $1", [first.id]);
      expect(await w.service(invoice, [org, client, job])).toHaveLength(1);
    }));

  it("a Stripe event is claimed once", () =>
    scenario(db, async (w) => {
      const claim = "insert into public.stripe_events (id, type) values ('evt_test_1', 'invoice.paid')";
      await w.service(claim);
      expect(await refusal(w.service(claim))).toBe("23505");
    }));
});

describe("that cleaner is already booked (23P01)", () => {
  const at = (hour: number) => `2031-06-09T${String(hour).padStart(2, "0")}:00:00Z`;

  it("a new overlap is refused; back-to-back is not", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const manager = await addMember(w.seed, org, "manager");
      const anna = await addMember(w.seed, org, "employee", "Anna");
      const client = await addClient(w.seed, org);
      const morning = await addBooking(w.seed, org, client, { scheduledAt: at(15), durationMinutes: 240 });
      const clash = await addBooking(w.seed, org, client, { scheduledAt: at(17), durationMinutes: 120 });
      const after = await addBooking(w.seed, org, client, { scheduledAt: at(19), durationMinutes: 120 });
      const assign =
        "insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)";
      const office = w.as(manager.userId);
      await office(assign, [org, morning, anna.membershipId]);
      expect(await refusal(office(assign, [org, clash, anna.membershipId]))).toBe("23P01");
      await office(assign, [org, after, anna.membershipId]);
      // Dragging the later job back into the morning one is refused the same way.
      expect(
        await refusal(office("update public.bookings set scheduled_at = $2 where id = $1", [after, at(18)])),
      ).toBe("23P01");
    }));

  /**
   * The hours on a job are one person's estimate. Two people on a four-hour
   * job are each busy for two when the company divides hours, so a job two
   * hours later is free for either of them. The last case is the one fixed
   * on 2026-11-10: pausing automations must not change how long a job is.
   */
  it("measures a divided team job by each person's share, with automations on or paused", () =>
    scenario(db, async (w) => {
      for (const [divides, master, expected] of [
        [false, true, "23P01"],
        [true, true, null],
        [true, false, null],
      ] as const) {
        const org = await addOrg(w.seed);
        await w.seed(
          "update public.organizations set automations_enabled = $2, automation_settings = $3::jsonb where id = $1",
          [org, master, JSON.stringify({ divide_crew_hours: { enabled: divides } })],
        );
        const manager = await addMember(w.seed, org, "manager");
        const anna = await addMember(w.seed, org, "employee", "Anna");
        const bea = await addMember(w.seed, org, "employee", "Bea");
        const client = await addClient(w.seed, org);
        const team = await addBooking(w.seed, org, client, { scheduledAt: at(15), durationMinutes: 240 });
        await addCrew(w.seed, org, team, anna.membershipId);
        await addCrew(w.seed, org, team, bea.membershipId);
        const later = await addBooking(w.seed, org, client, { scheduledAt: at(17), durationMinutes: 60 });
        const got = await refusal(
          w.as(manager.userId)(
            "insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)",
            [org, later, anna.membershipId],
          ),
        );
        expect(got, `divides=${divides} automations=${master}`).toBe(expected);
      }
    }));

  /**
   * 39dc99b. Old double-bookings exist in real data. The guard refuses a
   * write that creates an overlap, not every write to a job that already
   * has one, or nobody could edit those jobs at all.
   */
  it("leaves an overlap that already exists editable", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const manager = await addMember(w.seed, org, "manager");
      const anna = await addMember(w.seed, org, "employee", "Anna");
      const client = await addClient(w.seed, org);
      const first = await addBooking(w.seed, org, client, { scheduledAt: at(15), durationMinutes: 240 });
      const second = await addBooking(w.seed, org, client, { scheduledAt: at(16), durationMinutes: 240 });
      // History the guard never saw: put the overlap in with triggers off.
      await w.seed("set local session_replication_role = replica");
      await addCrew(w.seed, org, first, anna.membershipId);
      await addCrew(w.seed, org, second, anna.membershipId);
      await w.seed("set local session_replication_role = origin");

      const office = w.as(manager.userId);
      expect(
        await office("update public.bookings set notes = 'bring the long ladder' where id = $1 returning id", [second]),
      ).toHaveLength(1);
      // Same schedule written again: nothing new, nothing refused.
      expect(
        await office("update public.bookings set duration_minutes = 240 where id = $1 returning id", [second]),
      ).toHaveLength(1);
    }));
});

describe("still in use (23503)", () => {
  /**
   * Shifts are what payroll, invoices and job history are computed from, and
   * the delete confirmation promises they are preserved. Until 2026-11-10
   * they cascaded away with the membership (migration 20261110030000).
   */
  const shift = `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at)
                 values ($1, $2, '2031-06-01T15:00:00Z', '2031-06-01T17:00:00Z')`;

  it("a member with recorded shifts cannot be deleted, and the shifts stay", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const anna = await addMember(w.seed, org, "employee", "Anna");
      await w.seed(shift, [org, anna.membershipId]);
      expect(
        await refusal(w.service("delete from public.memberships where id = $1", [anna.membershipId])),
      ).toBe("23503");
      const [left] = await w.seed<{ n: number }>("select count(*)::int as n from public.time_entries");
      expect(left.n).toBe(1);
    }));

  /** auth.users -> profiles -> memberships -> time_entries was one cascade. */
  it("deleting her login cannot take her shifts with it", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const anna = await addMember(w.seed, org, "employee", "Anna");
      await w.seed(shift, [org, anna.membershipId]);
      expect(await refusal(w.seed("delete from auth.users where id = $1", [anna.userId]))).toBe("23503");
      const [left] = await w.seed<{ members: number; shifts: number }>(
        `select (select count(*)::int from public.memberships where id = $1) as members,
                (select count(*)::int from public.time_entries) as shifts`,
        [anna.membershipId],
      );
      expect(left).toEqual({ members: 1, shifts: 1 });
    }));

  it("someone who never clocked in can still be removed", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const invited = await addMember(w.seed, org, "employee", "Never Came");
      expect(
        await w.service("delete from public.memberships where id = $1 returning id", [invited.membershipId]),
      ).toHaveLength(1);
    }));

  /** Why the keys are NO ACTION and not RESTRICT. */
  it("closing a whole company still removes its people and their shifts together", () =>
    scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const anna = await addMember(w.seed, org, "employee", "Anna");
      await w.seed(shift, [org, anna.membershipId]);
      expect(await w.seed("delete from public.organizations where id = $1 returning id", [org])).toHaveLength(1);
      const [left] = await w.seed<{ n: number }>(
        "select count(*)::int as n from public.time_entries where organization_id = $1",
        [org],
      );
      expect(left.n).toBe(0);
    }));
});
