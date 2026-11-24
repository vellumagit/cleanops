/**
 * The office's everyday clicks on a job and its money.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, fill, getStack, openAs, says, visit, type Stack } from "./stack";
import { company, job, minutesFromNow, one, type Company } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

/** A draft invoice with one line, as auto-invoicing raises it for a finished job. */
async function draftInvoice(c: Company, bookingId: string | null, cents = 14000): Promise<string> {
  const [inv] = await stack.api.sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
     values ($1, $2, $3, 'draft', $4) returning id`,
    [c.org, c.client, bookingId, cents],
  );
  await stack.api.sql(
    `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
     values ($1, $2, 'Standard clean', 1, $3, $4)`,
    [c.org, inv.id, cents, bookingId],
  );
  if (bookingId) {
    await stack.api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [bookingId, inv.id]);
  }
  return inv.id;
}

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("the office, on a job", () => {
  it("Mark complete closes a job nobody tapped, says who closed it, and drafts the invoice", async () => {
    const c = await company(stack, "Close");
    // Ended an hour ago; nobody clocked in; not yet closed by itself.
    const id = await job(stack, c, { at: minutesFromNow(-180), minutes: 120, crew: [c.anna] });
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/bookings/${id}`);
      await click(owner.page, "Mark complete");
      await expect
        .poll(() => one(stack, "select status::text from public.bookings where id = $1", [id]), { timeout: 20_000 })
        .toBe("completed");
      await visit(stack, owner.page, `/app/bookings/${id}`);
      await says(owner.page, "Closed by Olivia Owner");
      await says(owner.page, /Invoice .* drafted/);
      await expectNoCrash(owner);
      expect(await one<number>(stack, "select count(*)::int from public.invoices where booking_id = $1", [id])).toBe(1);
    } finally {
      await owner.close();
    }
  });
});

describe("the office, on the recurring list", () => {
  it("a visit an invoice already names is not offered for billing again, even when the job's own stamp is missing", async () => {
    const c = await company(stack, "Series");
    const sql = stack.api.sql;
    const [other] = await sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Pat Unbilled') returning id",
      [c.org],
    );
    const series = async (client: string) =>
      (
        await sql<{ id: string }>(
          `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
           values ($1, $2, 'weekly', '09:00', current_date - 30, 120) returning id`,
          [c.org, client],
        )
      )[0].id;
    const billedSeries = await series(c.client);
    const owedSeries = await series(other.id);

    // Billed in June-2026 fashion: a line names the job, nothing stamped it.
    const billedVisit = await job(stack, c, { at: minutesFromNow(-5 * 24 * 60), status: "completed", crew: [c.anna] });
    await sql("update public.bookings set series_id = $2 where id = $1", [billedVisit, billedSeries]);
    const [inv] = await sql<{ id: string }>(
      `insert into public.invoices (organization_id, client_id, status, amount_cents)
       values ($1, $2, 'sent', 14000) returning id`,
      [c.org, c.client],
    );
    await sql(
      `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
       values ($1, $2, 'Standard clean', 1, 14000, $3)`,
      [c.org, inv.id, billedVisit],
    );
    // Really owed: finished, on no invoice.
    const owedVisit = await job(stack, c, { at: minutesFromNow(-4 * 24 * 60), status: "completed", crew: [c.bea] });
    await sql("update public.bookings set series_id = $2, client_id = $3 where id = $1", [owedVisit, owedSeries, other.id]);

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/bookings/series");
      await says(owner.page, "Pat Unbilled");
      const rows = await owner.page.$$eval("tbody tr", (trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, " ")));
      const rowFor = (name: string) => rows.find((r) => r.includes(name)) ?? "";
      expect(rowFor("Pat Unbilled")).toContain("1 unbilled");
      expect(rowFor(c.clientName)).toContain("billed up");
      expect(rowFor(c.clientName)).not.toContain("unbilled");
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });
});

describe("the office, on an invoice", () => {
  it("Delete invoice: it goes, the list opens, and nothing says it failed", async () => {
    // Svit, 2026-11-23: six deletes, all of which worked, and each one
    // answered "Delete failed — try again." A successful delete redirects,
    // the redirect reaches the button as a rejection, and the button's
    // catch read it as a failure and stopped the page moving on.
    const c = await company(stack, "DeleteInv");
    const invoice = await draftInvoice(c, null, 14000);
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/invoices/${invoice}/edit`);
      await click(owner.page, "Delete invoice");
      await expect
        .poll(() => one<number>(stack, "select count(*)::int from public.invoices where id = $1", [invoice]), { timeout: 20_000 })
        .toBe(0);
      await owner.page.waitForFunction(() => location.pathname === "/app/invoices", { timeout: 20_000 });
      const text = await owner.page.evaluate(() => document.body.innerText);
      expect(text).not.toContain("Delete failed");
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });

  it("Add discount: 10% of $140 takes $14 off, saved as its own line", async () => {
    const c = await company(stack, "Discount");
    const invoice = await draftInvoice(c, null, 14000);
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/invoices/${invoice}/edit`);
      await click(owner.page, "Add discount");
      await fill(owner.page, "[aria-label='Discount percent (optional)']", "10");
      // The amount follows the percentage.
      await owner.page.waitForFunction(
        () => (document.querySelector("[aria-label='Discount amount']") as HTMLInputElement | null)?.value === "14.00",
      );
      await click(owner.page, "Save changes");
      await expect
        .poll(() => one<number>(stack, "select amount_cents from public.invoices where id = $1", [invoice]), { timeout: 20_000 })
        .toBe(12600);
      expect(
        await one<number>(
          stack,
          "select unit_price_cents from public.invoice_line_items where invoice_id = $1 and unit_price_cents < 0",
          [invoice],
        ),
      ).toBe(-1400);
      await expectNoCrash(owner);
    } finally {
      await owner.close();
    }
  });

  it("Bill for a period: ticking two jobs' drafts combines them into one invoice and voids the drafts", async () => {
    const c = await company(stack, "Period");
    const first = await job(stack, c, { at: minutesFromNow(-3 * 24 * 60), minutes: 120, status: "completed", crew: [c.anna] });
    const second = await job(stack, c, { at: minutesFromNow(-2 * 24 * 60), minutes: 120, status: "completed", crew: [c.anna] });
    const draftA = await draftInvoice(c, first);
    const draftB = await draftInvoice(c, second);

    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, `/app/invoices/period?client_id=${c.client}&from=${day(-7)}&to=${day(0)}`);
      await says(owner.page, "Tick the drafts you want combined");
      const boxes = await owner.page.$$("li label input[type='checkbox']");
      expect(boxes.length).toBe(2);
      for (const box of boxes) await box.click();
      await click(owner.page, /Create draft invoice/);
      // Svitlana's refusal, word for word, must not come back.
      await expect
        .poll(
          () =>
            one<number>(
              stack,
              "select count(*)::int from public.invoices where organization_id = $1 and status = 'void' and id = any($2::uuid[])",
              [c.org, [draftA, draftB]],
            ),
          { timeout: 20_000 },
        )
        .toBe(2);
      const text = await owner.page.evaluate(() => document.body.innerText);
      expect(text).not.toMatch(/already bills this job/i);
      await expectNoCrash(owner);
      // One new draft holding both jobs.
      expect(
        await one<number>(
          stack,
          `select count(distinct li.booking_id)::int
             from public.invoices i join public.invoice_line_items li on li.invoice_id = i.id
            where i.organization_id = $1 and i.status = 'draft' and li.booking_id = any($2::uuid[])`,
          [c.org, [first, second]],
        ),
      ).toBe(2);
    } finally {
      await owner.close();
    }
  });
});

/**
 * 2026-11-19, asked for in person: each office person chooses which notices
 * alert them. The page, its ticks, and that the choice is still there after
 * a reload.
 */
describe("what alerts you", () => {
  it("a manager turns Money down, saves, and finds it still quiet on coming back; a cleaner has no such page", async () => {
    const c = await company(stack, "Alerts");
    const muted = async () =>
      (
        await stack.api.sql<{ p: { muted_topics?: string[] } }>(
          "select notification_prefs as p from public.memberships where id = $1",
          [c.manager.membershipId],
        )
      )[0].p.muted_topics ?? null;

    const manager = await openAs(stack, c.manager);
    try {
      // Found from the notifications page.
      await visit(stack, manager.page, "/app/notifications");
      await click(manager.page, "Choose what alerts you");
      await says(manager.page, "What alerts you");
      await says(manager.page, "You are alerted about everything.");

      await click(manager.page, /^Money/, { selector: "label" });
      await says(manager.page, /1 topic is quiet: no phone alert or email for it/);
      await click(manager.page, "Save");
      await expect.poll(muted, { timeout: 20_000 }).toEqual(["money"]);

      await visit(stack, manager.page, "/app/notifications/choices");
      await says(manager.page, /1 topic is quiet/);
      const ticked = await manager.page.$$eval("input[name='alert']", (els) =>
        els.filter((el) => (el as HTMLInputElement).checked).map((el) => (el as HTMLInputElement).value),
      );
      expect(ticked).toEqual(["schedule", "clock", "time_off", "clients", "team"]);
      // Fits a phone: nothing pushed off the side.
      await manager.page.setViewport({ width: 375, height: 800 });
      const over = await manager.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, "no sideways scroll on a phone").toBeLessThanOrEqual(1);
      await expectNoCrash(manager);
    } finally {
      await manager.close();
    }

    const anna = await openAs(stack, c.anna);
    try {
      // Sent away from it, to her own side of the app.
      await anna.page.goto(`${stack.base}/app/notifications/choices`, { waitUntil: "domcontentloaded" }).catch(() => null);
      await expect
        .poll(() => new URL(anna.page.url()).pathname, { timeout: 20_000 })
        .not.toBe("/app/notifications/choices");
    } finally {
      await anna.close();
    }
  });
});
