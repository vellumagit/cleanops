/**
 * A signed-in client books a time from their own area (roadmap phase 6,
 * 2026-11-25).
 *
 * Until the company lets its page take bookings, New clean is the request
 * form it always was. Once it does, New clean opens the same picker the
 * public page has, with the client's address filled in and no name, email
 * or phone asked: the visit goes on their own record, not a new lead.
 *
 * Drives clientOpenTimesAction (the days and times) and clientBookTimeAction
 * (the save) in app/client/(portal)/book/actions.ts, through the page.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, fill, getStack, says, visit, type Stack } from "./stack";
import { company } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** A day `n` days out on Regina's calendar (UTC-6 all year). */
const dayOut = (n: number) => new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const regina = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`) + 6 * 3_600_000;

describe("booking a time from the client area", () => {
  it("New clean opens the picker once the company takes bookings; the visit lands on the client's own record", { timeout: 240_000 }, async () => {
    const c = await company(stack, "ClientBook");
    const sql = stack.api.sql;
    const [{ name: companyName }] = await sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);
    const [user] = await sql<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb) returning id", [
      `clientbook.${Date.now()}@example.test`,
    ]);
    await sql("update public.clients set profile_id = $2 where id = $1", [c.client, user.id]);
    const clientsBefore = (await sql<{ n: number }>("select count(*)::int as n from public.clients where organization_id = $1", [c.org]))[0].n;

    const context = await stack.browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const cookie of stack.api.sessionCookies(user.id, "clientbook@example.test")) {
      await page.setCookie({ name: cookie.name, value: cookie.value, url: stack.base });
    }
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    /** Where the New clean tab goes. */
    const newCleanHref = () =>
      page.evaluate(() => [...document.querySelectorAll("nav a")].find((a) => (a as HTMLElement).innerText.includes("New clean"))?.getAttribute("href") ?? null);

    try {
      // No booking page yet: New clean is the request form, and the
      // picker's address sends them there.
      await visit(stack, page, "/client");
      await says(page, "Your next cleans");
      expect(await newCleanHref()).toBe("/client/request");
      await visit(stack, page, "/client/book");
      await says(page, "Ask for a clean");
      expect(new URL(page.url()).pathname).toBe("/client/request");
      expect(await page.evaluate(() => document.body.innerText)).not.toContain("Pick a time yourself");

      // The company publishes a page that books straight away.
      const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
      await sql(
        "insert into public.booking_pages (organization_id, slug, status, opening_hours, slot_step_minutes, time_booking) values ($1, $2, 'published', $3::jsonb, 60, 'instant')",
        [c.org, `clientbook-${Date.now().toString(36)}`, JSON.stringify(hours)],
      );
      await sql("update public.service_types set show_on_booking_page = true, booking_page_price = 'fixed' where organization_id = $1 and name = 'Standard clean'", [c.org]);
      await sql("update public.memberships set takes_online_bookings = true where id = $1", [c.anna.membershipId]);

      await visit(stack, page, "/client");
      await says(page, "Your next cleans");
      expect(await newCleanHref()).toBe("/client/book");
      await click(page, /New clean/, { selector: "nav a" });
      await says(page, "Pick a time that suits you.");
      // One service on the page: straight to the days.
      await says(page, "Which day?");
      const D = dayOut(3);
      await page.waitForSelector(`[data-testid='open-days'] [data-day='${D}']`, { visible: true });
      expect(await overflow(), "days, on a phone").toBeLessThanOrEqual(1);
      await page.click(`[data-testid='open-days'] [data-day='${D}']`);
      await says(page, "What time?");
      await click(page, "10:00 AM");

      // Only the address, already filled in; nothing about who they are.
      await says(page, "Your details");
      expect(await page.$eval("#book-address", (el) => (el as HTMLInputElement).value)).toBe("12 Test Street");
      for (const asked of ["#book-name", "#book-email", "#book-phone", "input[name='website']"]) {
        expect(await page.$(asked), `${asked} is not asked of a signed-in client`).toBeNull();
      }
      await fill(page, "#book-notes", "Gate code 4411");
      expect(await overflow(), "details, on a phone").toBeLessThanOrEqual(1);
      await click(page, "Book this clean");
      const done = await says(page, /You.re booked\./);
      expect(done).toContain("at 10:00 AM");
      expect(done).toContain(`${companyName} will see you then.`);
      expect(done).toContain("It's in My cleans too.");

      // On the client's own record: no new lead, no second client.
      const visits = await sql<{ id: string; client_id: string; status: string; at: string; lead: string | null; online: boolean; address: string | null }>(
        "select id, client_id, status::text as status, scheduled_at as at, assigned_to as lead, booked_online_at is not null as online, address from public.bookings where organization_id = $1 order by created_at",
        [c.org],
      );
      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({ client_id: c.client, status: "confirmed", lead: c.anna.membershipId, online: true, address: "12 Test Street" });
      expect(Date.parse(visits[0].at)).toBe(regina(D, "10:00"));
      expect((await sql<{ n: number }>("select count(*)::int as n from public.clients where organization_id = $1", [c.org]))[0].n).toBe(clientsBefore);
      // Their words reach the crew; the office is told where it came from.
      const note = await sql<{ body: string }>("select body from public.client_job_requests where booking_id = $1", [visits[0].id]);
      expect(note.map((n) => n.body)).toEqual(["Gate code 4411"]);
      const told = await sql<{ body: string }>("select distinct body from public.notifications where organization_id = $1 and title = 'Booked online'", [c.org]);
      expect(told.map((t) => t.body)).toEqual([expect.stringContaining("from their client account")]);

      // It's in My cleans.
      await visit(stack, page, "/client/jobs");
      await says(page, "Standard clean");
      // And the request form, still there, points to the picker.
      await visit(stack, page, "/client/request");
      await says(page, "Pick a time yourself");

      // Now the company confirms each one: the time is held, and says so.
      await sql("update public.booking_pages set time_booking = 'approve' where organization_id = $1", [c.org]);
      await visit(stack, page, "/client/book");
      await says(page, "confirms it by email");
      await page.waitForSelector(`[data-testid='open-days'] [data-day='${D}']`, { visible: true });
      await page.click(`[data-testid='open-days'] [data-day='${D}']`);
      await click(page, "2:00 PM");
      await click(page, "Ask for this time");
      const held = await says(page, `${companyName} is holding your time.`);
      expect(held).toContain("at 2:00 PM");
      const second = await sql<{ status: string; client_id: string }>(
        "select status::text as status, client_id from public.bookings where organization_id = $1 order by created_at desc limit 1",
        [c.org],
      );
      expect(second[0]).toEqual({ status: "pending", client_id: c.client });

      // Switched off again: back to the request form.
      await sql("update public.booking_pages set time_booking = 'off' where organization_id = $1", [c.org]);
      await visit(stack, page, "/client");
      await says(page, "Your next cleans");
      expect(await newCleanHref()).toBe("/client/request");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
