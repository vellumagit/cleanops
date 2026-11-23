/**
 * Settings, Online booking: when the company can be booked, by whom, and
 * the office's preview of the times that produces (roadmap phase 2).
 *
 * The owner saves the suggested hours and ticks a cleaner; the preview then
 * lists that cleaner's free starts, and a job on the calendar takes its
 * times out of the list.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { choose, click, expectNoCrash, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, job } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** The first Wednesday at least three days out, on Regina's calendar (UTC-6 all year). */
function aWednesday(): string {
  const d = new Date(Date.now() - 6 * 3_600_000);
  d.setUTCDate(d.getUTCDate() + 3);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
/** A Regina wall-clock time as an instant. */
const regina = (ymd: string, hhmm: string) => `${ymd}T${String(Number(hhmm.slice(0, 2)) + 6).padStart(2, "0")}:${hhmm.slice(3)}:00Z`;

describe("when you can be booked", () => {
  it("the owner saves hours and ticks a cleaner; the preview shows their free times, and a job removes its own", async () => {
    const c = await company(stack, "OpenTimes");
    const sql = stack.api.sql;
    await sql("insert into public.booking_pages (organization_id, slug, status) values ($1, $2, 'draft')", [c.org, `opentimes-${Date.now().toString(36)}`]);
    const [standard] = await sql<{ id: string }>("select id from public.service_types where organization_id = $1 and name = 'Standard clean'", [c.org]);
    const [deep] = await sql<{ id: string }>("select id from public.service_types where organization_id = $1 and name = 'Deep clean'", [c.org]);
    const wed = aWednesday();
    const path = `/app/settings/online-booking?service=${standard.id}&from=${wed}`;
    const dayText = (page: Awaited<ReturnType<typeof openAs>>["page"], ymd: string) =>
      page.$eval(`[data-testid='preview-days'] [data-day='${ymd}']`, (el) => (el as HTMLElement).innerText);

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, path);
      await says(owner.page, "No hours are saved yet, so you are closed every day.");
      await says(owner.page, "Nobody is ticked yet, so no time is open.");
      expect(await dayText(owner.page, wed), "nothing saved").toContain("Closed.");
      // The service row says how long it is and takes a crew size.
      await says(owner.page, /\$140\.00 · 2h/);

      // The suggested weekdays nine to five, and Anna.
      await click(owner.page, /Anna Cleaner/, { selector: "label" });
      await click(owner.page, "Save hours and people");
      await says(owner.page, "Saved. The preview below uses these.");
      const [saved] = await sql<{ hours: Record<string, unknown>; takes: number }>(
        `select p.opening_hours as hours,
                (select count(*)::int from public.memberships m where m.organization_id = p.organization_id and m.takes_online_bookings) as takes
           from public.booking_pages p where p.organization_id = $1`,
        [c.org],
      );
      expect(Object.keys(saved.hours).sort()).toEqual(["1", "2", "3", "4", "5"]);
      expect(saved.takes).toBe(1);

      // The preview, for that Wednesday.
      await visit(stack, owner.page, path);
      const summary = await owner.page.$eval("[data-testid='preview-summary']", (el) => (el as HTMLElement).innerText);
      expect(summary).toContain("Standard clean: 2h of work, 1 cleaner.");
      expect(summary).toContain("Taking online bookings: Anna Cleaner.");
      let text = await dayText(owner.page, wed);
      for (const t of ["9:00 AM", "11:00 AM", "11:30 AM", "3:00 PM"]) expect(text, t).toContain(t);
      expect(text, "a two-hour job can't start after three").not.toContain("3:30 PM");
      // Saturday that week is closed.
      const sat = new Date(Date.parse(`${wed}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
      expect(await dayText(owner.page, sat)).toContain("Closed.");

      // Anna gets a job, 11 to 1. With the half-hour gap: nothing between 8:30 and 1:30.
      await job(stack, c, { at: regina(wed, "11:00"), minutes: 120, crew: [c.anna] });
      await visit(stack, owner.page, path);
      text = await dayText(owner.page, wed);
      for (const t of ["9:00 AM", "10:30 AM", "11:00 AM", "1:00 PM"]) expect(text, `${t} is gone`).not.toContain(t);
      for (const t of ["1:30 PM", "3:00 PM"]) expect(text, t).toContain(t);

      // Nothing pushed off the side, at a laptop and a phone.
      for (const width of [1024, 390]) {
        await owner.page.setViewport({ width, height: 900 });
        expect(await owner.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `at ${width}px`).toBeLessThanOrEqual(1);
      }
      await owner.page.setViewport({ width: 1366, height: 900 });

      // Another service, from the preview's own form.
      await choose(owner.page, "#preview-service", deep.id);
      await click(owner.page, "Show");
      await says(owner.page, "Deep clean: 4h of work, 1 cleaner.");
      expect(await dayText(owner.page, wed), "four hours fits only after the job").not.toContain("9:00 AM");

      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });
});
