/**
 * An estimate with a price range, from the form to what the client sees.
 *
 * In person, 2026-11-19: quoting "between 300 and 400" as a tick on the
 * estimate. The office ticks it and types two prices; the client's page and
 * the PDF show the range.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { choose, click, expectNoCrash, fill, getStack, openAs, says, visit, type Stack } from "./stack";
import { company } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

describe("an estimate with a price range", () => {
  it("tick the box, type a low and a high price, and the client sees the range", async () => {
    const c = await company(stack, "Range");
    const owner = await openAs(stack, c.owner);
    try {
      await visit(stack, owner.page, "/app/estimates/new");
      await choose(owner.page, "#client_id", c.client);

      // Off to start with: one price per line, as before.
      expect(await owner.page.$("[aria-label='Line 1 price to']")).toBeNull();
      await fill(owner.page, "[aria-label='Line 1 description']", "Deep clean");
      await fill(owner.page, "[aria-label='Line 1 price each']", "300");
      await says(owner.page, /Total \(CAD\): \$300\.00/);

      await click(owner.page, /Give a price range/);
      await fill(owner.page, "[aria-label='Line 1 price to']", "400");
      const total = () => owner.page.$eval("[data-testid='estimate-total']", (el) => (el as HTMLElement).innerText);
      await expect.poll(total, { timeout: 10_000 }).toBe("$300.00 – $400.00");

      // A second line with no high price is a fixed amount inside the range.
      await click(owner.page, "Add line item");
      await fill(owner.page, "[aria-label='Line 2 description']", "Oven");
      await fill(owner.page, "[aria-label='Line 2 price from']", "50");
      await expect.poll(total, { timeout: 10_000 }).toBe("$350.00 – $450.00");

      // The extra column fits: nothing pushed off the side of the form, on a
      // small laptop or a phone.
      for (const width of [1024, 375]) {
        await owner.page.setViewport({ width, height: 900 });
        const over = await owner.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(1);
      }
      await owner.page.setViewport({ width: 1280, height: 900 });

      await click(owner.page, "Create estimate");
      const saved = async () =>
        (
          await stack.api.sql<{ id: string; low: number; high: number | null }>(
            "select id, total_cents as low, total_high_cents as high from public.estimates where organization_id = $1",
            [c.org],
          )
        )[0];
      await expect.poll(async () => (await saved())?.high ?? null, { timeout: 20_000 }).toBe(45000);
      const row = await saved();
      expect(row.low).toBe(35000);
      await expectNoCrash(owner);

      // Reopened, the tick is still on and both prices are back.
      await visit(stack, owner.page, `/app/estimates/${row.id}/edit`);
      await owner.page.waitForSelector("[aria-label='Line 1 price to']", { visible: true });
      expect(await owner.page.$eval("[aria-label='Line 1 price to']", (el) => (el as HTMLInputElement).value)).toBe("400.00");
      expect(await total()).toBe("$350.00 – $450.00");

      // The list shows the range too.
      await visit(stack, owner.page, "/app/estimates");
      await says(owner.page, /\$350\.00 – \$450\.00/);

      // What the client gets: the page behind the link, and the PDF.
      const token = "rangetoken1234567890";
      await stack.api.sql(
        "update public.estimates set status = 'sent', sent_at = now(), public_token = $2, expires_at = now() + interval '30 days' where id = $1",
        [row.id, token],
      );
      await visit(stack, owner.page, `/e/${token}`);
      const publicTotal = await owner.page.$eval("[data-testid='estimate-public-total']", (el) => (el as HTMLElement).innerText);
      expect(publicTotal).toBe("$350.00 – $450.00");
      const text = await says(owner.page, "Estimated total");
      expect(text).toMatch(/\$300\.00 – \$400\.00/);
      expect(text).toMatch(/Oven/);
      // The total fits the page at phone width: nothing pushed off the side.
      await owner.page.setViewport({ width: 375, height: 800 });
      const overflow = await owner.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no sideways scroll on a phone").toBeLessThanOrEqual(1);
      await expectNoCrash(owner);

      const pdf = await owner.page.evaluate(async (path) => {
        const res = await fetch(path);
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, type: res.headers.get("content-type"), head: String.fromCharCode(...bytes.slice(0, 5)), size: bytes.length };
      }, `/api/e/${token}/pdf`);
      expect(pdf).toMatchObject({ status: 200, head: "%PDF-" });
      expect(pdf.type).toContain("application/pdf");
      expect(pdf.size).toBeGreaterThan(800);
    } finally {
      await owner.close();
    }
  });
});
