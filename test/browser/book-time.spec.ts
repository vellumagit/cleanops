/**
 * "Book a clean": a stranger on a phone picks a day and a time on a
 * company's page, and a real visit lands on the office's calendar
 * (roadmap phase 3).
 *
 * The owner switches it on in Settings; until then the page has no such
 * button. Then booked straight away, and once more with the office
 * confirming each one.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { choose, click, expectNoCrash, fill, getStack, openAs, says, visit, type Stack } from "./stack";
import { company } from "./world";

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
type Phone = Awaited<ReturnType<typeof signedOut>>["page"];
const overflow = (page: Phone) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** A day `n` days out on Regina's calendar (UTC-6 all year). */
const dayOut = (n: number) => new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const regina = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`) + 6 * 3_600_000;

describe("booking a time on a company's page", () => {
  it("off until the owner switches it on; then a visitor on a phone books a time, and the office sees it", async () => {
    const c = await company(stack, "BookTime");
    const sql = stack.api.sql;
    const slug = `booktime-${Date.now().toString(36)}`;
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
    await sql("insert into public.booking_pages (organization_id, slug, status, opening_hours, slot_step_minutes) values ($1, $2, 'published', $3::jsonb, 60)", [c.org, slug, JSON.stringify(hours)]);
    await sql("update public.service_types set show_on_booking_page = true, booking_page_price = 'fixed' where organization_id = $1 and name = 'Standard clean'", [c.org]);
    await sql("update public.organizations set contact_phone = '(780) 555-0199' where id = $1", [c.org]);
    const [{ name: companyName }] = await sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);
    const D = dayOut(3);
    const visits = () =>
      sql<{ id: string; status: string; at: string; lead: string | null; online: boolean; address: string | null }>(
        "select id, status::text as status, scheduled_at as at, assigned_to as lead, booked_online_at is not null as online, address from public.bookings where organization_id = $1 order by created_at",
        [c.org],
      );

    const owner = await openAs(stack, c.owner);
    const phone = await signedOut();
    try {
      // Nothing changes for a page that hasn't switched it on.
      await visit(stack, phone.page, `/book/${slug}`);
      const before = await says(phone.page, "Ask for a clean");
      expect(before).not.toContain("Book a clean");
      // And the address itself sends them back to the page.
      await visit(stack, phone.page, `/book/${slug}/time`);
      await says(phone.page, "Ask for a clean");
      expect(new URL(phone.page.url()).pathname).toBe(`/book/${slug}`);

      // The owner switches it on, and says who takes online bookings.
      await visit(stack, owner.page, "/app/settings/online-booking");
      await choose(owner.page, "#time_booking", "instant");
      await click(owner.page, /Anna Cleaner/, { selector: "label" });
      await click(owner.page, "Save hours and people");
      await says(owner.page, "Saved. The preview below uses these.");

      // The visitor, on a phone.
      await visit(stack, phone.page, `/book/${slug}`);
      await click(phone.page, "Book a clean");
      // One service on the page, so straight to the days.
      await says(phone.page, "Which day?");
      await phone.page.waitForSelector(`[data-testid='open-days'] [data-day='${D}']`, { visible: true });
      expect(await overflow(phone.page), "days, on a phone").toBeLessThanOrEqual(1);
      const days = await phone.page.$eval("[data-testid='open-days']", (el) => (el as HTMLElement).innerText);
      expect(days).toContain("7 times");
      await phone.page.click(`[data-testid='open-days'] [data-day='${D}']`);

      await says(phone.page, "What time?");
      const offered = await phone.page.$eval("[data-testid='open-times']", (el) => (el as HTMLElement).innerText);
      expect(offered.split("\n").filter(Boolean)).toEqual(["9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"]);
      expect(await overflow(phone.page), "times, on a phone").toBeLessThanOrEqual(1);
      await click(phone.page, "10:00 AM");

      await says(phone.page, "Your details");
      const summary = await phone.page.$eval("[data-testid='picked-summary']", (el) => (el as HTMLElement).innerText);
      expect(summary).toContain("Standard clean");
      expect(summary).toContain("at 10:00 AM");
      expect(await overflow(phone.page), "details, on a phone").toBeLessThanOrEqual(1);
      await fill(phone.page, "#book-address", "12 Elm Street");
      await fill(phone.page, "#book-name", "Dana Whitfield");
      await fill(phone.page, "#book-email", "dana.books@example.test");
      await fill(phone.page, "#book-notes", "Two cats");
      await click(phone.page, "Book this clean");
      const done = await says(phone.page, /You.re booked\./);
      expect(done).toContain("at 10:00 AM");
      expect(done).toContain(`${companyName} will see you then.`);
      expect(await overflow(phone.page)).toBeLessThanOrEqual(1);

      const [v] = await visits();
      // Nobody is put on it: the office chooses who (2026-11-25).
      expect(v).toMatchObject({ status: "confirmed", lead: null, online: true, address: "12 Elm Street" });
      expect(Date.parse(v.at)).toBe(regina(D, "10:00"));

      // The office: the visit, marked, with the client's words.
      await visit(stack, owner.page, `/app/bookings/${v.id}`);
      await owner.page.waitForSelector("[data-testid='booked-online']", { visible: true });
      const officeView = await says(owner.page, "Dana Whitfield");
      expect(officeView).toContain("Booked online");
      expect(officeView).toContain("Two cats");

      // And the dashboard asks for a cleaner, with a button to put one on.
      await visit(stack, owner.page, "/app");
      const dash = await says(owner.page, "booked online, needs a cleaner");
      expect(dash).toContain("Dana Whitfield");
      expect(dash).toContain("Put a cleaner on it");

      // That morning has gone for the next visitor.
      await visit(stack, phone.page, `/book/${slug}/time`);
      await phone.page.waitForSelector(`[data-testid='open-days'] [data-day='${D}']`, { visible: true });
      await phone.page.click(`[data-testid='open-days'] [data-day='${D}']`);
      await says(phone.page, "What time?");
      const left = await phone.page.$eval("[data-testid='open-times']", (el) => (el as HTMLElement).innerText);
      expect(left.split("\n").filter(Boolean)).toEqual(["1:00 PM", "2:00 PM", "3:00 PM"]);
      // Back goes back a step, not off the page.
      await click(phone.page, "Back");
      await says(phone.page, "Which day?");

      // Now the office confirms each one: the time is held, and says so.
      await sql("update public.booking_pages set time_booking = 'approve' where organization_id = $1", [c.org]);
      await visit(stack, phone.page, `/book/${slug}/time`);
      await phone.page.waitForSelector(`[data-testid='open-days'] [data-day='${D}']`, { visible: true });
      await phone.page.click(`[data-testid='open-days'] [data-day='${D}']`);
      await click(phone.page, "2:00 PM");
      await fill(phone.page, "#book-address", "40 Oak Avenue");
      await fill(phone.page, "#book-name", "Sam Okafor");
      await fill(phone.page, "#book-email", "sam.holds@example.test");
      await click(phone.page, "Ask for this time");
      const held = await says(phone.page, `${companyName} is holding your time.`);
      expect(held).toContain("at 2:00 PM");
      expect(held).toContain("It isn’t confirmed yet.");
      const second = (await visits())[1];
      expect(second).toMatchObject({ status: "pending", online: true });
      await visit(stack, owner.page, `/app/bookings/${second.id}`);
      await says(owner.page, /Picked on your booking page\. The time is held/);

      await expectNoCrash(owner);
      expect(phone.errors).toEqual([]);
    } finally {
      await owner.close();
      await phone.close();
    }
  });
});
