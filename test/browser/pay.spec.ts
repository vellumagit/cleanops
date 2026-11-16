/**
 * Paying people: a rate change with a start date, extra pay, and the
 * contractor statement that carries both.
 *
 * All three came from one morning (2026-11-15): Vira's raise had to count
 * from the start of the period, not from the day it was typed in; and there
 * was nowhere to put travel time or a reimbursement.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { choose, click, expectNoCrash, fill, getStack, openAs, says, setValue, visit, type Stack } from "./stack";
import { company, one, type Company } from "./world";
import type { Member } from "../db/harness";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** The company's own calendar day, `offset` days from today (America/Regina). */
const orgDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Regina", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

/** A finished three-hour shift at noon, company time, `daysAgo` days back, at the rate she had then. */
async function shift(c: Company, who: Member, daysAgo: number, rateCents: number, engagement = "employee"): Promise<string> {
  const start = new Date(`${orgDay(-daysAgo)}T18:00:00Z`); // noon in Regina
  const [row] = await stack.api.sql<{ id: string }>(
    `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at, pay_rate_cents_snapshot, engagement_snapshot)
     values ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6) returning id`,
    [c.org, who.membershipId, start.toISOString(), new Date(start.getTime() + 3 * 3_600_000).toISOString(), rateCents, engagement],
  );
  return row.id;
}

describe("paying people", () => {
  it("a raise that starts from a date re-prices the unpaid shifts since then, says so, and keeps a history", async () => {
    const c = await company(stack, "Raise");
    const before = await shift(c, c.anna, 9, 2200);
    const after = await shift(c, c.anna, 3, 2200);
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/employees/${c.anna.membershipId}/edit`);
      await fill(owner.page, "input[name='pay_rate']", "23.00");
      await says(owner.page, "When does the new rate start?");
      await click(owner.page, /From a date/);
      await setValue(owner.page, "[aria-label='New rate starts from']", orgDay(-5));
      await click(owner.page, "Save changes");
      await says(owner.page, /1 unpaid shift for Anna Cleaner is now at \$23\.00\/hr/);
      await expectNoCrash(owner);

      const rate = (id: string) =>
        one<number>(stack, "select pay_rate_cents_snapshot from public.time_entries where id = $1", [id]);
      expect(await rate(after)).toBe(2300);
      // Worked before the start date: keeps what she was paid then.
      expect(await rate(before)).toBe(2200);

      await visit(stack, owner.page, `/app/employees/${c.anna.membershipId}`);
      await says(owner.page, "Pay rate history");
      const text = await says(owner.page, "$23.00/hr");
      expect(text).toContain("$22.00/hr");
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });

  it("travel pay for a contractor: added on the period, seen on her phone, and carried onto her statement", async () => {
    const c = await company(stack, "Addon");
    await stack.api.sql("update public.memberships set engagement = 'subcontractor' where id = $1", [c.anna.membershipId]);
    const worked = await shift(c, c.anna, 3, 2200, "subcontractor");
    const owner = await openAs(stack, c.owner);
    const anna = await openAs(stack, c.anna, { phone: true });
    try {
      await visit(stack, owner.page, `/app/payroll/periods/${orgDay(-13)}_${orgDay(0)}`);
      await click(owner.page, "Add");
      await choose(owner.page, "#addon-person", c.anna.membershipId);
      await choose(owner.page, "#addon-kind", "travel");
      await fill(owner.page, "#addon-amount", "25");
      await setValue(owner.page, "#addon-date", orgDay(-3));
      await fill(owner.page, "#addon-note", "Drive to the Smith job");
      await click(owner.page, "Save add-on");
      await expect
        .poll(
          () => one<number>(stack, "select coalesce(sum(amount_cents), 0)::int from public.pay_addons where organization_id = $1", [c.org]),
          { timeout: 20_000 },
        )
        .toBe(2500);
      await says(owner.page, "Drive to the Smith job");
      await expectNoCrash(owner);

      // She sees it before any statement exists.
      await visit(stack, anna.page, "/field/pay");
      await says(anna.page, "Drive to the Smith job");
      await says(anna.page, "$25.00");
      await expectNoCrash(anna);

      // Preparing the period puts her hours and the add-on on one statement.
      await visit(stack, owner.page, "/app/payroll");
      await click(owner.page, /Start this run/);
      // Done when her shift carries the statement's stamp: that is the last
      // thing preparing a period writes.
      await expect
        .poll(
          () => one<boolean>(stack, "select subcontractor_run_id is not null from public.time_entries where id = $1", [worked]),
          { timeout: 30_000 },
        )
        .toBe(true);
      const [item] = await stack.api.sql<{ minutes: number; total_cents: number; addons_cents: number }>(
        `select i.minutes, i.total_cents, i.addons_cents
           from public.subcontractor_pay_items i
           join public.subcontractor_pay_runs r on r.id = i.run_id
          where r.organization_id = $1 and i.membership_id = $2`,
        [c.org, c.anna.membershipId],
      );
      // Three hours at $22 plus $25 travel.
      expect(item).toEqual({ minutes: 180, total_cents: 9100, addons_cents: 2500 });
      await expect
        .poll(
          () => one<boolean>(stack, "select subcontractor_run_id is not null from public.pay_addons where organization_id = $1", [c.org]),
          { timeout: 20_000 },
        )
        .toBe(true);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
      await anna.close();
    }
  });
});
