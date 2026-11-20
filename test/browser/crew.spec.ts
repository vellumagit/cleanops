/**
 * Changing a job's crew from its page.
 *
 * Two real days are pinned here:
 *
 *  - 2026-11-12, Olha: putting a cleaner on a job that overlapped another of
 *    hers showed a crash screen instead of the refusal. The database was
 *    right to refuse; the form never got to say so.
 *  - 2026-11-15, Svitlana: putting two cleaners on a Thursday 9:00 job was
 *    refused as a double-booking although the second job was at 11:30. Two
 *    people split the hours, so each is there for half the time.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, daysFromNow, job, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

const crewSize = (id: string) =>
  one<number>(stack, "select count(*)::int from public.booking_assignees where booking_id = $1", [id]);

const DIALOG = "[role='dialog']";

describe("changing a job's crew", () => {
  it("two cleaners share a four-hour job: the one with a job right after her half is not refused", async () => {
    const c = await company(stack, "Thursday");
    const nine = new Date(daysFromNow(3));
    nine.setUTCMinutes(0, 0, 0);
    const elevenThirty = new Date(nine.getTime() + 150 * 60_000);
    // Four hours for one person; divided between two it is 9:00 to 11:00 each.
    const morning = await job(stack, c, { at: nine.toISOString(), minutes: 240, crew: [c.bea] });
    await job(stack, c, { at: elevenThirty.toISOString(), minutes: 120, crew: [c.anna] });

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${morning}`);
      await click(owner.page, "Change crew");
      await says(owner.page, "Assign cleaners");
      await click(owner.page, /Anna Cleaner/, { within: DIALOG });
      await click(owner.page, /Review & save/, { within: DIALOG });
      await click(owner.page, /Yes, assign 2 cleaners/, { within: DIALOG });
      await expect.poll(() => crewSize(morning), { timeout: 20_000 }).toBe(2);
      await expectNoCrash(owner);
      expect(await owner.page.evaluate(() => document.body.innerText)).not.toMatch(/overlapping booking|already booked/i);
    } finally {
      await owner.close();
    }
  });

  it("the same change when the company does NOT divide hours: each works all four, so it is refused", async () => {
    // The other half of the test above: the pass there comes from the
    // shared hours, not from the check being switched off.
    const c = await company(stack, "Undivided");
    await stack.api.sql("update public.organizations set automation_settings = '{}'::jsonb where id = $1", [c.org]);
    const nine = new Date(daysFromNow(3));
    nine.setUTCMinutes(0, 0, 0);
    const morning = await job(stack, c, { at: nine.toISOString(), minutes: 240, crew: [c.bea] });
    await job(stack, c, { at: new Date(nine.getTime() + 150 * 60_000).toISOString(), minutes: 120, crew: [c.anna] });

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${morning}`);
      await click(owner.page, "Change crew");
      await says(owner.page, "Assign cleaners");
      await click(owner.page, /Anna Cleaner/, { within: DIALOG });
      await click(owner.page, /Review & save/, { within: DIALOG });
      await click(owner.page, /Yes, assign 2 cleaners/, { within: DIALOG });
      await says(owner.page, /Anna Cleaner is already booked then/);
      await expectNoCrash(owner);
      expect(await crewSize(morning)).toBe(1);
    } finally {
      await owner.close();
    }
  });

  it("a real double-booking is refused in words, on the form, not with a crash screen", async () => {
    const c = await company(stack, "Clash");
    const at = daysFromNow(3);
    await job(stack, c, { at, minutes: 120, crew: [c.anna] });
    const other = await job(stack, c, { at, minutes: 120, crew: [c.bea] });

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${other}`);
      await click(owner.page, "Change crew");
      await says(owner.page, "Assign cleaners");
      // The pop-up says so before the save does: she is listed under "Not
      // free at that time", with the job she is on.
      await says(owner.page, /Not free at that time/i);
      await says(owner.page, /Anna Cleaner\s+On another job then/);
      await click(owner.page, /Anna Cleaner/, { within: DIALOG });
      await click(owner.page, /Review & save/, { within: DIALOG });
      await click(owner.page, /Yes, assign 2 cleaners/, { within: DIALOG });
      // Who, and that nothing was changed.
      await says(owner.page, /Anna Cleaner is already booked then/);
      await expectNoCrash(owner);
      expect(await crewSize(other)).toBe(1);
    } finally {
      await owner.close();
    }
  });
});

/**
 * 2026-11-19, asked for in person: putting a cleaner on a recurring series
 * was refused whole when she had another job on any one of its dates, so
 * the office filled every visit by hand. Now she goes on every visit she is
 * free for, and the others say they need cover: in the pop-up, on the list,
 * on the visit and on the dashboard.
 */
describe("a recurring series' crew, when the cleaner has another job on one date", () => {
  it("she is put on the visits she is free for; the other is marked Needs cover everywhere the office looks", async () => {
    const c = await company(stack, "Series");
    const when = (days: number) => {
      const d = new Date(daysFromNow(days));
      d.setUTCHours(16, 0, 0, 0); // 10:00 AM company time
      return d.toISOString();
    };
    const [series] = await stack.api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'weekly', '10:00', current_date, 120) returning id`,
      [c.org, c.client],
    );
    const visits: string[] = [];
    for (const days of [2, 4, 6]) {
      const id = await job(stack, c, { at: when(days), minutes: 120, crew: [] });
      await stack.api.sql("update public.bookings set series_id = $2 where id = $1", [id, series.id]);
      visits.push(id);
    }
    // Anna is already on another job at the time of the second visit.
    await job(stack, c, { at: when(4), minutes: 120, crew: [c.anna] });

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${visits[0]}`);
      await click(owner.page, "Assign crew");
      await says(owner.page, "Assign cleaners");
      await click(owner.page, /Anna Cleaner/, { within: DIALOG });
      await click(owner.page, /This and all future bookings/, { within: DIALOG });
      await click(owner.page, /Save this & future/, { within: DIALOG });

      // Saved, and the pop-up stays to say what it left off.
      const notice = await says(owner.page, /Anna Cleaner is on another job on 1 of the 3 visits/);
      expect(notice).toMatch(/was left off it\. That visit is marked "Needs cover"/);
      expect(await crewSize(visits[0])).toBe(1);
      expect(await crewSize(visits[1])).toBe(0);
      expect(await crewSize(visits[2])).toBe(1);
      await click(owner.page, "Done", { within: DIALOG });
      await expectNoCrash(owner);

      // The list: the chip on that visit's row.
      await visit(stack, owner.page, "/app/bookings");
      await says(owner.page, "Needs cover");

      // The visit itself: who, which job, and what to do.
      await visit(stack, owner.page, `/app/bookings/${visits[1]}`);
      const note = await owner.page.$eval("[data-testid='needs-cover']", (el) => (el as HTMLElement).innerText);
      expect(note).toMatch(/Needs cover\. Anna Cleaner is on another job then \(.+, 10:00 AM\), so they were left off this visit/);

      // The dashboard: it is inside the coming week, so it asks.
      await visit(stack, owner.page, "/app");
      const dash = await says(owner.page, /needs cover/);
      expect(dash).toMatch(/Anna Cleaner is on another job then/);

      // Picking someone else answers it everywhere.
      await visit(stack, owner.page, `/app/bookings/${visits[1]}`);
      await click(owner.page, "Assign crew");
      await says(owner.page, "Assign cleaners");
      await click(owner.page, /Bea Cleaner/, { within: DIALOG });
      await click(owner.page, "Save", { within: DIALOG });
      await expect.poll(() => crewSize(visits[1]), { timeout: 20_000 }).toBe(1);
      await visit(stack, owner.page, `/app/bookings/${visits[1]}`);
      expect(await owner.page.$("[data-testid='needs-cover']")).toBeNull();
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });
});
