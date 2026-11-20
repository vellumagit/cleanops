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
