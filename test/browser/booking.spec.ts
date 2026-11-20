/**
 * Booking a job from the office, and the refusals a person should be able
 * to read.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { choose, click, expectNoCrash, fill, getStack, openAs, says, setValue, visit, type Stack } from "./stack";
import { company, daysFromNow, job, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** What a datetime-local field holds for this instant, in the company's zone (America/Regina, UTC-6 all year). */
const localInput = (iso: string) => new Date(new Date(iso).getTime() - 6 * 3_600_000).toISOString().slice(0, 16);

describe("booking a job", () => {
  it("a new job for a client, with a cleaner on it, is saved and shows on the list", async () => {
    const c = await company(stack, "Book");
    const when = new Date(daysFromNow(4));
    when.setUTCHours(16, 0, 0, 0); // 10:00 AM company time
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/bookings/new");
      await choose(owner.page, "#client_id", c.client);
      await setValue(owner.page, "#scheduled_at", localInput(when.toISOString()));
      await click(owner.page, /Anna Cleaner/, { within: "#crew" });
      await click(owner.page, "Create booking");
      // Saved when her crew row is there: the job is written first, its crew second.
      await expect
        .poll(
          () =>
            one<number>(
              stack,
              "select count(*)::int from public.booking_assignees where organization_id = $1 and membership_id = $2",
              [c.org, c.anna.membershipId],
            ),
          { timeout: 30_000 },
        )
        .toBe(1);
      const rows = await stack.api.sql<{ id: string; scheduled_at: string; status: string; assigned_to: string | null }>(
        "select id, scheduled_at, status::text, assigned_to from public.bookings where organization_id = $1",
        [c.org],
      );
      expect(rows.length).toBe(1);
      const row = rows[0];
      // The time she picked, not an hour either side of it.
      expect(new Date(row.scheduled_at).toISOString()).toBe(when.toISOString());
      expect(row.assigned_to).toBe(c.anna.membershipId);

      await visit(stack, owner.page, "/app/bookings");
      await says(owner.page, c.clientName);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });

  it("booking a cleaner onto a time she is already working is refused in words, and nothing is saved", async () => {
    const c = await company(stack, "BookClash");
    const when = new Date(daysFromNow(4));
    when.setUTCHours(16, 0, 0, 0);
    await job(stack, c, { at: when.toISOString(), minutes: 120, crew: [c.anna] });
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/bookings/new");
      await choose(owner.page, "#client_id", c.client);
      await setValue(owner.page, "#scheduled_at", localInput(when.toISOString()));
      // Since 2026-11-19 the picker lists who is free: Anna is working then,
      // so she is tucked away with the reason, and Bea is still offered.
      await says(owner.page, /Show 1 who isn.t free then/);
      const offered = await owner.page.$eval("#crew", (el) => (el as HTMLElement).innerText);
      expect(offered).toContain("Bea Cleaner");
      expect(offered).not.toContain("Anna Cleaner");
      await click(owner.page, /Show 1 who isn.t free then/);
      await says(owner.page, /On another job then: .+, 10:00 AM/);
      // The office can still pick her; she moves up, marked with why.
      await click(owner.page, /Anna Cleaner/, { within: "[aria-label='Not free at that time']" });
      await says(owner.page, /Anna Cleaner isn.t free: On another job then/);
      await click(owner.page, "Create booking");
      await says(owner.page, /already booked then/);
      await expectNoCrash(owner);
      expect(await one<number>(stack, "select count(*)::int from public.bookings where organization_id = $1", [c.org])).toBe(1);
    } finally {
      await owner.close();
    }
  });
});

describe("a refusal the database makes reaches the form as a sentence", () => {
  it("a second service with the same name", async () => {
    const c = await company(stack, "Service");
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/settings/services");
      await click(owner.page, "Add service");
      await fill(owner.page, "input[name='name']", "Standard clean");
      await click(owner.page, "Add service", { selector: "button[type='submit']" });
      await says(owner.page, "A service with that name already exists.");
      await expectNoCrash(owner);
      expect(
        await one<number>(stack, "select count(*)::int from public.service_types where organization_id = $1", [c.org]),
      ).toBe(2);
    } finally {
      await owner.close();
    }
  });
});
