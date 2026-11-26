/**
 * Searching invoices past the newest 500 (2026-11-25).
 *
 * The Invoices page loads the newest 500 and its search box looked only
 * through those. Svit had 350 and adds 55 to 60 a month, so from about
 * February a client's older invoices would have been out of reach. Now a
 * search on a full list also asks the server (searchAllInvoicesAction in
 * src/app/app/invoices/search-actions.ts) for every invoice whose client
 * name or number contains a word typed.
 *
 * Here: 505 newer invoices for another client, and Leslie Oldbill with two
 * from a year ago, one paid and one sent. Her name finds both on All, the
 * Paid tab shows only the paid one, and her invoice number finds it too.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, fill, getStack, openAs, read, says, visit, type Stack } from "./stack";
import { company } from "./world";

let stack: Stack;
beforeAll(async () => {
  stack = await getStack();
});

const SEARCH = "input[placeholder^='Search client']";

describe("searching invoices past the newest 500", () => {
  it("finds a client's old invoices by name and by number, and the tabs still apply", { timeout: 300_000 }, async () => {
    const c = await company(stack, "InvSearch");
    const sql = stack.api.sql;
    const [{ id: leslie }] = await sql<{ id: string }>(
      "insert into public.clients (organization_id, name) values ($1, 'Leslie Oldbill') returning id",
      [c.org],
    );
    const old = await sql<{ number: string; status: string }>(
      `insert into public.invoices (organization_id, client_id, status, amount_cents, created_at)
       values ($1, $2, 'paid', 11100, now() - interval '400 days'),
              ($1, $2, 'sent', 22200, now() - interval '390 days')
       returning number, status::text`,
      [c.org, leslie],
    );
    const paidNumber = old.find((o) => o.status === "paid")!.number;
    const sentNumber = old.find((o) => o.status === "sent")!.number;
    await sql(
      `insert into public.invoices (organization_id, client_id, status, amount_cents, created_at)
       select $1::uuid, $2::uuid, 'draft'::public.invoice_status, 5000, now() - make_interval(hours => g)
         from generate_series(1, 505) g`,
      [c.org, c.client],
    );

    const owner = await openAs(stack, c.owner);
    const page = owner.page;
    await page.setViewport({ width: 1440, height: 900 });
    const tab = (name: string) => click(page, new RegExp(`^${name}\\s*\\d*$`), { selector: "button" });
    try {
      await visit(stack, page, "/app/invoices?tab=all");
      await says(page, "Showing the newest 500 invoices");
      expect(await read(page)).not.toContain("Leslie Oldbill");

      // Her name: both of hers, from a year back.
      await fill(page, SEARCH, "Oldbill");
      await says(page, "Leslie Oldbill", 60_000);
      await says(page, "Older invoices searched too.");
      let text = await read(page);
      expect(text).toContain(paidNumber);
      expect(text).toContain(sentNumber);
      expect(text).toMatch(/2 of 502/); // the newest 500, and her two

      // The Paid tab, same search: only the paid one.
      await tab("Paid");
      await page.waitForFunction((n) => !document.body.innerText.includes(n), { timeout: 30_000 }, sentNumber);
      text = await read(page);
      expect(text).toContain(paidNumber);
      expect(text).not.toContain(sentNumber);

      // Her paid invoice's number, on All.
      await tab("All");
      await fill(page, SEARCH, paidNumber);
      await says(page, "Older invoices searched too.", 60_000);
      text = await read(page);
      expect(text).toContain("Leslie Oldbill");
      expect(text).not.toContain(sentNumber);

      // A search that matches nothing anywhere says so.
      await fill(page, SEARCH, "Nobody Called This");
      await says(page, /No matches for/, 60_000);
    } finally {
      await owner.close();
    }
  });
});
