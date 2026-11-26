/**
 * The review page keeps one review per visit (2026-11-26, fix-later #100).
 *
 * It used to keep one per client, ever: the portal offered "Leave a review"
 * on every finished visit, but a client who had reviewed one visit opened the
 * next visit's link and saw their old review and a thank-you, with no way to
 * review the new one. The page and its save now ask the same question
 * (existingReview in src/lib/review-dedup.ts): has THIS visit been reviewed?
 *
 * Here: a client reviewed last week's visit. That visit's link shows the
 * review they left; this week's visit's link shows the form, and sending it
 * saves a review for this week's visit, credited to the cleaner on it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { click, getStack, openAs, read, says, type Stack } from "./stack";
import { company, daysFromNow, job } from "./world";

let stack: Stack;
let restoreEnv: () => void = () => {};
let reviewLinkToken: typeof import("@/lib/review-token").reviewLinkToken;

beforeAll(async () => {
  stack = await getStack();
  // Links signed with the same key the app checks them with.
  restoreEnv = stack.api.useAsSupabase();
  ({ reviewLinkToken } = await import("@/lib/review-token"));
});

afterAll(() => restoreEnv());

describe("the review page, one review per visit", () => {
  it("a reviewed visit shows its review; the client's next visit can still be reviewed", async () => {
    const c = await company(stack, "RevPage");
    const sql = stack.api.sql;
    const lastWeek = await job(stack, c, { at: daysFromNow(-8), status: "completed", crew: [c.anna] });
    const thisWeek = await job(stack, c, { at: daysFromNow(-1), status: "completed", crew: [c.bea] });
    await sql(
      `insert into public.reviews (organization_id, client_id, booking_id, employee_id, rating, comment)
       values ($1, $2, $3, $4, 5, 'Anna was wonderful.')`,
      [c.org, c.client, lastWeek, c.anna.membershipId],
    );

    const screen = await openAs(stack, c.owner, { phone: true });
    const page = screen.page;
    try {
      // Not visit(): it waits for a button, and the thank-you has none (the
      // Google button needs a Google link set).
      await page.goto(`${stack.base}/review/${reviewLinkToken("booking", lastWeek)}`, { waitUntil: "load" });
      await says(page, "Thank you for your review!", 90_000);
      expect(await read(page)).toContain("Anna was wonderful.");

      await page.goto(`${stack.base}/review/${reviewLinkToken("booking", thisWeek)}`, { waitUntil: "load" });
      const before = await says(page, "Submit Review", 90_000);
      expect(before).not.toContain("Thank you for your review!");
      expect(before).not.toContain("Anna was wonderful.");

      await page.click("button[aria-label='4 stars']");
      await click(page, /^Submit Review$/, { selector: "button" });
      await says(page, /Thank you/, 30_000);

      const saved = await sql<{ rating: number; employee_id: string | null }>(
        "select rating, employee_id from public.reviews where booking_id = $1",
        [thisWeek],
      );
      expect(saved).toEqual([{ rating: 4, employee_id: c.bea.membershipId }]);
      expect(screen.errors).toEqual([]);
    } finally {
      await screen.close();
    }
  });
});
