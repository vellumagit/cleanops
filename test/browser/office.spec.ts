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

describe("the office, on an invoice", () => {
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
