/**
 * Searching the bookings list for one client (2026-11-25).
 *
 * A company with a year of recurring visits booked ahead has more than a
 * thousand bookings from today on. The list searched only the newest 1,000
 * it had loaded, so a client's past visits were never among them, and a
 * search skipped the time tab altogether: Past with "Brian" typed showed his
 * upcoming visits, All showed nothing older, Today showed every day.
 *
 * Here: another client with 1,050 visits ahead and 1,050 in the last weeks,
 * and the client searched for with three visits long ago, one today and two
 * ahead. Each tab shows exactly that client's visits for that tab.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { click, fill, getStack, openAs, read, says, visit, type Stack } from "./stack";
import { company, minutesFromNow } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

const LABELS = {
  past: ["Brianna past one", "Brianna past two", "Brianna past three"],
  today: ["Brianna today"],
  ahead: ["Brianna ahead one", "Brianna ahead two"],
};
const everyLabel = [...LABELS.past, ...LABELS.today, ...LABELS.ahead];

/** Which of Brianna's visits the list is showing right now. */
async function shown(page: Page): Promise<string[]> {
  const text = await read(page);
  return everyLabel.filter((l) => text.includes(l));
}

async function tab(page: Page, name: "Upcoming" | "Today" | "Past" | "All") {
  await click(page, new RegExp(`^${name}\\s*(\\d+|·)?$`), { selector: "button" });
}

describe("searching the bookings list for one client", () => {
  it("every tab shows that client's visits for that tab, past ones included, however much is booked ahead", { timeout: 300_000 }, async () => {
    const c = await company(stack, "Search");
    const sql = stack.api.sql;
    const [{ id: brianna }] = await sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Brianna Searchwell') returning id",
      [c.org],
    );
    // The other client: 1,050 visits in the coming months and 1,050 in the
    // last few weeks, so neither half of the list has room for Brianna's.
    await sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, status)
       select $1::uuid, $2::uuid, now() + make_interval(days => 2, hours => g * 3), 60, 'standard'::public.service_type, 'Standard clean', 'confirmed'::public.booking_status
         from generate_series(1, 1050) g
       union all
       select $1::uuid, $2::uuid, now() - make_interval(days => 2, hours => g), 60, 'standard'::public.service_type, 'Standard clean', 'completed'::public.booking_status
         from generate_series(1, 1050) g`,
      [c.org, c.client],
    );
    const add = async (label: string, at: string, status: string) =>
      sql(
        `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, service_type_label, status)
         values ($1, $2, $3::timestamptz, 120, 'standard', $4, $5::public.booking_status)`,
        [c.org, brianna, at, label, status],
      );
    await add(LABELS.past[0], minutesFromNow(-200 * 24 * 60), "completed");
    await add(LABELS.past[1], minutesFromNow(-300 * 24 * 60), "completed");
    await add(LABELS.past[2], minutesFromNow(-400 * 24 * 60), "completed");
    // Today in the company's zone (Regina, UTC-6): noon there.
    const noon = new Date(Date.now() - 6 * 3_600_000);
    noon.setUTCHours(18, 0, 0, 0);
    await add(LABELS.today[0], noon.toISOString(), "confirmed");
    await add(LABELS.ahead[0], minutesFromNow(400 * 24 * 60), "confirmed");
    await add(LABELS.ahead[1], minutesFromNow(500 * 24 * 60), "confirmed");

    const owner = await openAs(stack, c.owner);
    const page = owner.page;
    await page.setViewport({ width: 1440, height: 900 });
    try {
      // Upcoming (the default), searched: today's and the ones ahead.
      await visit(stack, page, "/app/bookings");
      await fill(page, "input[placeholder^='Search client']", "Brianna");
      await says(page, LABELS.ahead[1]);
      expect(await shown(page)).toEqual([...LABELS.today, ...LABELS.ahead]);

      // Past, still searched: only the ones long gone, all three.
      await tab(page, "Past");
      await says(page, LABELS.past[2], 60_000);
      expect(await shown(page)).toEqual(LABELS.past);
      expect(await read(page)).toMatch(/Showing 3 of 3 bookings matching "Brianna"/);

      // Today: just today's.
      await tab(page, "Today");
      await page.waitForFunction(() => !document.body.innerText.includes("Brianna past one"), { timeout: 30_000 });
      expect(await shown(page)).toEqual(LABELS.today);

      // All: every one of hers, and nobody else's.
      await tab(page, "All");
      await says(page, LABELS.past[2], 60_000);
      expect(await shown(page)).toEqual(everyLabel);
      expect(await read(page)).toMatch(/Showing 6 of 6 bookings matching "Brianna"/);

      // Opened on Past with no search, the list holds the latest 1,000 past
      // visits, none of them hers. Typing her name asks the server again.
      await visit(stack, page, "/app/bookings?tab=past");
      await says(page, /Showing \d+ of 1,?000/);
      expect(await shown(page)).toEqual([]);
      await fill(page, "input[placeholder^='Search client']", "Brianna");
      await says(page, LABELS.past[2], 60_000);
      expect(await shown(page)).toEqual(LABELS.past);

      // A search that matches nothing says so, rather than "No bookings yet".
      await fill(page, "input[placeholder^='Search client']", "Nobody By This Name");
      await says(page, "No bookings match your filters", 60_000);
    } finally {
      await owner.close();
    }
  });
});
