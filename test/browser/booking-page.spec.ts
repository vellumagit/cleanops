/**
 * A company's own booking page (roadmap phase 1), from Settings to a
 * stranger's phone.
 *
 * The office makes the page: claims the name, ticks a service, previews the
 * draft, publishes. A visitor on a phone then asks for a clean, and it
 * lands in the office's requests inbox. A draft is "not found" to anyone
 * who isn't that company's office.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { click, expectNoCrash, fill, getStack, openAs, says, visit, type Stack } from "./stack";
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
const overflow = (page: Awaited<ReturnType<typeof signedOut>>["page"]) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

describe("a company's booking page", () => {
  it("the owner makes it, previews the draft, publishes it; a visitor on a phone asks for a clean", async () => {
    const c = await company(stack, "BookPage");
    await stack.api.sql("update public.organizations set contact_phone = '(780) 555-0199' where id = $1", [c.org]);
    const [{ name: companyName }] = await stack.api.sql<{ name: string }>("select name from public.organizations where id = $1", [c.org]);
    const slug = `bookpage-${Date.now().toString(36)}`;
    const pageRow = async () =>
      (await stack.api.sql<{ slug: string; status: string }>("select slug::text as slug, status from public.booking_pages where organization_id = $1", [c.org]))[0] ?? null;

    const owner = await openAs(stack, c.owner);
    const stranger = await signedOut();
    try {
      // Found from Settings; nothing exists yet.
      await visit(stack, owner.page, "/app/settings");
      await click(owner.page, /Online booking/);
      await says(owner.page, /You don.t have a booking page yet\./);
      expect(await pageRow()).toBeNull();

      await fill(owner.page, "#name", slug);
      await says(owner.page, new RegExp(`/book/${slug}`));
      await click(owner.page, "Make my page, as a draft");
      await expect.poll(async () => (await pageRow())?.status ?? null, { timeout: 20_000 }).toBe("draft");
      await owner.page.waitForSelector("[data-testid='page-status']", { visible: true });
      expect(await owner.page.$eval("[data-testid='page-status']", (el) => (el as HTMLElement).innerText)).toBe("Draft");

      // The words, and one service shown with a "From" price.
      await fill(owner.page, "#headline", "House cleaning you can count on");
      await fill(owner.page, "#intro", "Family run. Fully insured.");
      await click(owner.page, /Standard clean/, { selector: "label" });
      await owner.page.select("select[aria-label='How Standard clean shows its price']", "from");
      await click(owner.page, "Save");
      await says(owner.page, "Saved.");
      // Nothing pushed off the side of the settings screen.
      for (const width of [1024, 390]) {
        await owner.page.setViewport({ width, height: 900 });
        expect(await owner.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `settings at ${width}px`).toBeLessThanOrEqual(1);
      }
      await owner.page.setViewport({ width: 1366, height: 900 });

      // A draft: the owner sees a preview; a stranger sees nothing there.
      await visit(stack, stranger.page, `/book/${slug}`);
      const hidden = await stranger.page.evaluate(() => document.body.innerText);
      expect(hidden).not.toContain(companyName);
      expect(hidden).not.toContain("House cleaning you can count on");

      await visit(stack, owner.page, `/book/${slug}`);
      await owner.page.waitForSelector("[data-testid='preview-banner']", { visible: true });
      const preview = await says(owner.page, "House cleaning you can count on");
      expect(preview).toContain("From $140.00");
      expect(preview).toContain("the form is switched off");

      // Publish.
      await visit(stack, owner.page, "/app/settings/online-booking");
      await click(owner.page, "Publish");
      await says(owner.page, /Your page is live/);
      expect((await pageRow())?.status).toBe("published");

      // The stranger, on a phone.
      await visit(stack, stranger.page, `/book/${slug}`);
      const text = await says(stranger.page, "House cleaning you can count on");
      expect(text).toContain(companyName);
      expect(text).toContain("Family run. Fully insured.");
      expect(text).toContain("Standard clean");
      expect(text).toContain("From $140.00");
      expect(text).not.toContain("Deep clean");
      expect(text).toContain("(780) 555-0199");
      expect(text).not.toMatch(/Preview\./);
      expect(await overflow(stranger.page), "no sideways scroll on a phone").toBeLessThanOrEqual(1);

      await fill(stranger.page, "#ask-address", "12 Elm Street");
      await fill(stranger.page, "#ask-notes", "Two cats");
      await fill(stranger.page, "#ask-name", "Dana Whitfield");
      await fill(stranger.page, "#ask-email", "dana.whitfield@example.test");
      await click(stranger.page, "Send my request");
      await says(stranger.page, new RegExp(`Thank you\\. ${companyName} has your request\\.`));
      expect(await overflow(stranger.page)).toBeLessThanOrEqual(1);

      const filed = await stack.api.sql<{ service: string; status: string; name: string; lifecycle: string }>(
        `select r.service_type as service, r.status, cl.name, cl.lifecycle
           from public.booking_requests r join public.clients cl on cl.id = r.client_id
          where r.organization_id = $1`,
        [c.org],
      );
      expect(filed).toEqual([{ service: "Standard clean", status: "pending", name: "Dana Whitfield", lifecycle: "lead" }]);

      // It is in the office's inbox.
      await visit(stack, owner.page, "/app/bookings/requests");
      await says(owner.page, "Dana Whitfield");

      // "See my cleans" goes to the client sign-in.
      await visit(stack, stranger.page, `/book/${slug}`);
      await click(stranger.page, "See my cleans");
      await says(stranger.page, "Email me a link");

      // Taken down: gone for the stranger again.
      await visit(stack, owner.page, "/app/settings/online-booking");
      await click(owner.page, "Take it down");
      await says(owner.page, /Your page is taken down/);
      await visit(stack, stranger.page, `/book/${slug}`);
      expect(await stranger.page.evaluate(() => document.body.innerText)).not.toContain("House cleaning you can count on");

      await expectNoCrash(owner);
      expect(stranger.errors).toEqual([]);
    } finally {
      await owner.close();
      await stranger.close();
    }
  });
});
