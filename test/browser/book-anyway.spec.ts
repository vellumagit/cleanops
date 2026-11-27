/**
 * "Book anyway", pressed in a real browser.
 *
 * Svitlana, 2026-11-26: Carmen North's visit, two days before and already
 * Completed, ran 45 minutes over into Veronika's 1 PM job. She made it
 * longer, was refused with the clash named, pressed Book anyway, and was
 * refused again, five times. The server ignored the press for a Completed
 * visit (fixed in 5b04abfa; test/db/book-anyway.api.test.ts holds the
 * server side). This holds the whole path: the button on the edit page
 * posts the key, and the visit saves.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, fill, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, daysFromNow, job, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

describe("Book anyway", () => {
  it("a Completed visit made longer into the cleaner's next job saves on the press", async () => {
    const c = await company(stack, "BookAnyway");
    const day = new Date(daysFromNow(-2));
    /** UTC hour and minute, two days ago. The company is UTC-6 all year. */
    const at = (h: number, m: number) => {
      const d = new Date(day);
      d.setUTCHours(h, m, 0, 0);
      return d.toISOString();
    };
    // 8:30 AM for four hours, done; her next job at 1 PM, done too.
    const visitId = await job(stack, c, { at: at(14, 30), minutes: 240, status: "completed", crew: [c.anna] });
    const next = await job(stack, c, { at: at(19, 0), minutes: 180, status: "completed", crew: [c.anna] });
    await stack.api.sql("update public.bookings set closed_at = now() where id = any($1::uuid[])", [[visitId, next]]);
    const minutes = () => one<number>(stack, "select duration_minutes from public.bookings where id = $1", [visitId]);

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${visitId}/edit`);
      // Four hours forty-five: 8:30 to 1:15, into the 1 PM job.
      await fill(owner.page, "input[aria-label='Minutes']", "45");
      await click(owner.page, "Save changes");
      await says(owner.page, /Anna Cleaner is already booked then/);
      expect(await minutes(), "the refusal saved nothing").toBe(240);

      await click(owner.page, "Book anyway", { selector: "[data-testid='book-anyway']" });
      await expect.poll(minutes, { timeout: 30_000 }).toBe(285);
      const [row] = await stack.api.sql<{ status: string; at: string }>(
        "select status::text, scheduled_at as at from public.bookings where id = $1",
        [visitId],
      );
      expect(row.status, "still Completed").toBe("completed");
      expect(new Date(row.at).toISOString(), "still 8:30").toBe(at(14, 30));
      // Written just after the save commits, so it may land a moment later.
      await expect
        .poll(
          () =>
            one<number>(
              stack,
              "select count(*)::int from public.audit_log where entity_id = $1 and after->>'via' = 'book_anyway'",
              [visitId],
            ),
          { timeout: 15_000, message: "the press is on record" },
        )
        .toBe(1);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });
});
