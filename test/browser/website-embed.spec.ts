/**
 * A company puts its booking page on its own website (roadmap phase 6).
 *
 * The owner copies the two snippets from Settings. A "company website" on
 * another address (127.0.0.1, not localhost: another site, so no cookies
 * cross, as on the real web) carries them. A visitor there sees the
 * booking page inside the site, sized to fit, and asks for a clean without
 * leaving; the button opens the page itself.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Frame } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookingButtonHtml, bookingEmbedHtml } from "@/lib/website-embed";
import { brandButtonColors } from "@/lib/readable-on";
import { getStack, openAs, recentAppLog, says, visit, type Stack } from "./stack";
import { company } from "./world";

let stack: Stack;
let site: Server | null = null;
beforeAll(async () => {
  stack = await getStack();
});
afterAll(async () => {
  await new Promise<void>((resolve) => (site ? site.close(() => resolve()) : resolve()));
});

/** A small company website, on its own address, carrying this HTML. */
async function companyWebsite(html: string): Promise<string> {
  site = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>Bright Homes</title></head><body style="margin:0;font-family:sans-serif">
<h1>Bright Homes Cleaning</h1><p>Family run since 2009.</p>
${html}
<footer id="after">Bright Homes, Edmonton</footer></body></html>`);
  });
  await new Promise<void>((resolve) => site!.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
}

const frameText = (f: Frame) => f.evaluate(() => document.body.innerText.replace(/ /g, " "));

describe("the booking page on a company's own website", () => {
  it("the owner copies the snippets; a visitor books from inside the company's site, and the button opens the page", async () => {
    const c = await company(stack, "Embed");
    const slug = `embed-${Date.now().toString(36)}`;
    await stack.api.sql(
      "update public.organizations set brand_color = '0f766e', contact_phone = '(780) 555-0142' where id = $1",
      [c.org],
    );
    await stack.api.sql(
      "insert into public.booking_pages (organization_id, slug, status, headline) values ($1, $2, 'published', 'Sparkling homes, every time')",
      [c.org, slug],
    );

    // Settings shows both, ready to copy.
    const owner = await openAs(stack, c.owner);
    let embedSnippet = "";
    let buttonSnippet = "";
    try {
      await visit(stack, owner.page, "/app/settings/online-booking");
      await owner.page.waitForSelector("[data-testid='website-snippets']", { visible: true });
      embedSnippet = await owner.page.$eval("#snippet-embed", (el) => (el as HTMLTextAreaElement).value);
      buttonSnippet = await owner.page.$eval("#snippet-button", (el) => (el as HTMLTextAreaElement).value);
      const where = embedSnippet.match(/src="(https?:\/\/[^/"]+)\/embed\/book\.js"/)?.[1];
      expect(where, embedSnippet).toBeTruthy();
      expect(embedSnippet).toBe(bookingEmbedHtml(where!, slug));
      expect(buttonSnippet).toBe(bookingButtonHtml(where!, slug, brandButtonColors("0f766e")));
      expect(buttonSnippet).toContain("background:#0f766e");
      expect(await owner.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    } finally {
      await owner.close();
    }

    // The test app's site address may be production's; the website here
    // points the same snippets at this test app instead.
    const origin = embedSnippet.match(/src="(https?:\/\/[^/"]+)\//)![1];
    const local = (s: string) => s.split(origin).join(stack.base);
    const websiteUrl = await companyWebsite(`${local(buttonSnippet)}\n<div id="booking">${local(embedSnippet)}</div>`);

    const context = await stack.browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.setDefaultTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(websiteUrl, { waitUntil: "domcontentloaded" });
      const frame = await page.waitForFrame((f) => f.url().includes(`/book/${slug}?embed=1`), { timeout: 90_000 });
      await frame.waitForFunction(() => document.body.innerText.includes("Sparkling homes, every time"), { timeout: 90_000 });

      // It fits: the frame takes the page's height (it starts at 900px),
      // and the company's own footer follows right after it.
      const sized = await page.waitForFunction(
        () => {
          const f = document.querySelector("iframe[data-sollos-booking]") as HTMLIFrameElement | null;
          const h = f ? parseInt(f.style.height, 10) : 0;
          return h > 0 && h !== 900 ? h : false;
        },
        { timeout: 90_000, polling: 200 },
      );
      const height = (await sized.jsonValue()) as number;
      const inner = await frame.evaluate(() => Math.ceil((document.querySelector("[data-embed-root]") as HTMLElement).getBoundingClientRect().height));
      expect(Math.abs(height - inner), "frame height = page height").toBeLessThanOrEqual(2);
      expect(await frame.evaluate(() => document.documentElement.scrollHeight - window.innerHeight), "no scroll bar inside the frame").toBeLessThanOrEqual(2);
      const text = await frameText(frame);
      expect(text).toContain("(780) 555-0142");
      // Signing in can't happen inside someone else's site: it opens a tab.
      expect(await frame.$eval("a[href='/client/login']", (a) => a.getAttribute("target"))).toBe("_blank");

      // Asking for a clean works without leaving the company's site.
      const field = async (sel: string, value: string) => {
        const el = await frame.waitForSelector(sel, { visible: true });
        await el!.type(value);
      };
      await field("#ask-service", "A regular house clean");
      await field("#ask-address", "4 Birch Lane");
      await field("#ask-name", "Robin Ames");
      await field("#ask-email", "robin.ames@example.test");
      const send = await frame.waitForSelector("xpath/.//button[normalize-space()='Send my request']", { visible: true });
      await send!.evaluate((b) => (b as HTMLElement).scrollIntoView({ block: "center" }));
      await send!.click();
      await frame.waitForFunction(() => /has your request\./.test(document.body.innerText), { timeout: 60_000 }).catch(async (e) => {
        throw new Error(`${e}\nFRAME SAYS:\n${(await frameText(frame)).slice(-1200)}\nAPP LOG:\n${recentAppLog(2500)}\nPAGE ERRORS: ${errors.join(" | ")}`);
      });
      expect(page.url(), "still on the company's website").toBe(websiteUrl);
      await expect
        .poll(
          async () =>
            (await stack.api.sql<{ name: string }>(
              "select cl.name from public.booking_requests r join public.clients cl on cl.id = r.client_id where r.organization_id = $1",
              [c.org],
            )).map((r) => r.name),
          { timeout: 20_000 },
        )
        .toEqual(["Robin Ames"]);
      // The thank-you is shorter than the form: the frame followed it.
      await page.waitForFunction(
        (before: number) => {
          const f = document.querySelector("iframe[data-sollos-booking]") as HTMLIFrameElement | null;
          return !!f && parseInt(f.style.height, 10) < before;
        },
        { timeout: 20_000, polling: 200 },
        height,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "no sideways scroll on a phone").toBeLessThanOrEqual(1);

      // The button opens the booking page itself.
      await page.goto(websiteUrl, { waitUntil: "domcontentloaded" });
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`a[href$='/book/${slug}']`)]);
      expect(page.url()).toBe(`${stack.base}/book/${slug}`);
      await says(page, "Sparkling homes, every time");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("only the booking pages may sit inside another site", async () => {
    const framing = async (path: string) => {
      const res = await fetch(stack.base + path, { redirect: "manual" });
      return /frame-ancestors ([^;]+)/.exec(res.headers.get("content-security-policy") ?? "")?.[1]?.trim();
    };
    expect(await framing("/book/anything")).toBe("*");
    expect(await framing("/book/anything/time")).toBe("*");
    expect(await framing("/client/login")).toBe("'none'");
    expect(await framing("/app")).toBe("'none'");
    expect(await framing("/v/sometoken")).toBe("'none'");
    const script = await fetch(`${stack.base}/embed/book.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("sollos:height");
  });
});
