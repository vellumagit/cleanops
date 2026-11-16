/**
 * A cleaner's day on her phone: I'm here, I'm done.
 *
 * Since the 2026-11-14 cutover the taps only record her shift; the rules
 * (src/lib/job-state.ts) decide what the job's status is from the shifts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, job, minutesFromNow, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

describe("a cleaner's taps", () => {
  it("alone on a job: I'm here starts it, I'm done finishes it and drafts the invoice", async () => {
    const c = await company(stack, "Solo");
    const id = await job(stack, c, { at: minutesFromNow(-20), minutes: 120, crew: [c.anna] });
    const anna = await openAs(stack, c.anna, { phone: true });
    try {
      await visit(stack, anna.page, `/field/jobs/${id}`);
      await click(anna.page, "I'm here");
      await says(anna.page, "On the clock");
      await says(anna.page, "In progress");
      expect(await one(stack, "select status::text from public.bookings where id = $1", [id])).toBe("in_progress");

      // Two taps: the second confirms.
      await click(anna.page, "I'm done");
      await click(anna.page, /Tap again/);
      await says(anna.page, "Job complete");
      await expectNoCrash(anna);
      expect(await one(stack, "select status::text from public.bookings where id = $1", [id])).toBe("completed");
      expect(await one<number>(stack, "select count(*)::int from public.invoices where booking_id = $1", [id])).toBe(1);
    } finally {
      await anna.close();
    }
  });

  it("two on a job: it stays open until the second is done, and says so", async () => {
    const c = await company(stack, "Pair");
    const id = await job(stack, c, { at: minutesFromNow(-20), minutes: 240, crew: [c.anna, c.bea] });
    const anna = await openAs(stack, c.anna, { phone: true });
    const bea = await openAs(stack, c.bea, { phone: true });
    try {
      await visit(stack, anna.page, `/field/jobs/${id}`);
      await click(anna.page, "I'm here");
      await says(anna.page, "On the clock");
      await click(anna.page, "I'm done");
      await click(anna.page, /Tap again/);
      await says(anna.page, "The job stays open until the rest of the crew is");
      expect(await one(stack, "select status::text from public.bookings where id = $1", [id])).toBe("in_progress");

      await visit(stack, bea.page, `/field/jobs/${id}`);
      await click(bea.page, "I'm here");
      await says(bea.page, "On the clock");
      await click(bea.page, "I'm done");
      await click(bea.page, /Tap again/);
      await says(bea.page, "Job complete");
      await expectNoCrash(anna);
      await expectNoCrash(bea);
      expect(await one(stack, "select status::text from public.bookings where id = $1", [id])).toBe("completed");
    } finally {
      await anna.close();
      await bea.close();
    }
  });
});
