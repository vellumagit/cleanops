/**
 * Cancelling a job from the office, as a person does it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectNoCrash, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, daysFromNow, job, one } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

describe("the office cancels a job", () => {
  it("from the bookings list: it shows cancelled, and the job's history says who", async () => {
    const c = await company(stack, "Cancel");
    const id = await job(stack, c, { at: daysFromNow(2) });
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/bookings");
      await says(owner.page, c.clientName);
      // The status dropdown on the job's row.
      await owner.page.waitForSelector("tbody select", { visible: true });
      await owner.page.select("tbody select", "cancelled");
      await owner.page.waitForFunction(
        () => (document.querySelector("tbody select") as HTMLSelectElement | null)?.value === "cancelled",
      );
      // The write is what matters, not the dropdown showing its own choice.
      await expect
        .poll(() => one(stack, "select status::text from public.bookings where id = $1", [id]), { timeout: 20_000 })
        .toBe("cancelled");

      await visit(stack, owner.page, `/app/bookings/${id}`);
      await says(owner.page, "Cancelled by Olivia Owner");
      await expectNoCrash(owner);

      // The crew was told, once.
      await expect
        .poll(
          () =>
            one<number>(
              stack,
              "select count(*)::int from public.notifications where organization_id = $1 and recipient_membership_id = $2 and title = 'Job cancelled'",
              [c.org, c.anna.membershipId],
            ),
          { timeout: 20_000 },
        )
        .toBe(1);
    } finally {
      await owner.close();
    }
  });
});
