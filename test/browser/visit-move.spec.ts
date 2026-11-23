/**
 * A client moves their own clean from the link in a booking email, on a
 * phone, with no sign-in (roadmap phase 4).
 *
 * Offered only where the company lets visitors book straight away;
 * otherwise the page keeps "Ask to move this visit".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, getStack, says, visit, type Stack } from "./stack";
import { company, job } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

async function signedOut() {
  const context = await stack.browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, close: () => context.close() };
}
const dayOut = (n: number) => new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const regina = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`) + 6 * 3_600_000;

describe("moving a clean from its link", () => {
  it("the client picks another day and time, confirms, and the visit moves", async () => {
    const c = await company(stack, "MoveVisit");
    const sql = stack.api.sql;
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
    await sql(
      "insert into public.booking_pages (organization_id, slug, status, time_booking, opening_hours, slot_step_minutes) values ($1, $2, 'published', 'approve', $3::jsonb, 60)",
      [c.org, `movevisit-${Date.now().toString(36)}`, JSON.stringify(hours)],
    );
    const D = dayOut(5);
    const NEXT = dayOut(6);
    const id = await job(stack, c, { at: new Date(regina(D, "10:00")).toISOString(), minutes: 120, crew: [c.anna] });
    const token = `mv${Date.now().toString(36)}`.padEnd(24, "x");
    await sql("update public.bookings set manage_token = $2 where id = $1", [id, token]);
    const overflow = () => phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    const phone = await signedOut();
    try {
      // The company confirms each booking: moving is a request, as before.
      await visit(stack, phone.page, `/v/${token}`);
      const asking = await says(phone.page, "Ask to move this visit");
      expect(asking).not.toContain("Move to another time");
      await visit(stack, phone.page, `/v/${token}/move`);
      await says(phone.page, "To move this visit, ask us and we'll find a time with you.");

      // Booked straight away: the client can pick a time themselves.
      await sql("update public.booking_pages set time_booking = 'instant' where organization_id = $1", [c.org]);
      await visit(stack, phone.page, `/v/${token}`);
      const offered = await says(phone.page, "Move to another time");
      expect(offered).not.toContain("Ask to move this visit");
      await click(phone.page, /Move to another time/);

      await says(phone.page, "Which day instead?");
      await says(phone.page, /Booked for now[\s\S]*at 10:00 AM/);
      await phone.page.waitForSelector(`[data-testid='open-days'] [data-day='${NEXT}']`, { visible: true });
      expect(await overflow(), "days, on a phone").toBeLessThanOrEqual(1);
      await phone.page.click(`[data-testid='open-days'] [data-day='${NEXT}']`);
      await says(phone.page, "What time?");
      await click(phone.page, "2:00 PM");

      await says(phone.page, "Move it to this time?");
      expect(await phone.page.$eval("[data-testid='move-summary']", (el) => (el as HTMLElement).innerText)).toMatch(/at 2:00 PM$/);
      expect(await overflow(), "confirm, on a phone").toBeLessThanOrEqual(1);
      // Nothing has changed yet.
      expect(Date.parse((await sql<{ at: string }>("select scheduled_at as at from public.bookings where id = $1", [id]))[0].at)).toBe(regina(D, "10:00"));

      await click(phone.page, "Yes, move my clean");
      const done = await says(phone.page, "Your clean is moved.");
      expect(done).toContain("at 2:00 PM");
      await expect
        .poll(async () => Date.parse((await sql<{ at: string }>("select scheduled_at as at from public.bookings where id = $1", [id]))[0].at), { timeout: 20_000 })
        .toBe(regina(NEXT, "14:00"));

      // Back on the visit: the new time, with the same cleaner.
      await click(phone.page, "See my clean");
      const after = await says(phone.page, "Your cleaner");
      expect(after).toContain("2:00 PM");
      expect(after).toContain("Anna");
      expect(await overflow()).toBeLessThanOrEqual(1);
      expect(phone.errors).toEqual([]);
    } finally {
      await phone.close();
    }
  });
});
