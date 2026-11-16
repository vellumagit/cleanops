/**
 * Every page, opened by the person who would open it: no crash screen, no
 * error in the browser, no server error.
 *
 * The list of pages is read from src/app at the start of the run, so a page
 * added later is crawled without anyone remembering to add it here. Who
 * opens each page follows from where it lives:
 *
 *   /app/...                    the owner (sees every office page)
 *   /field/...                  a cleaner
 *   client/(portal)/...         a client signed in to the portal
 *   everything else             nobody signed in
 *
 * A page with an id in its address gets a real one where this file seeds
 * it (a job, a client, an invoice, an employee, a pay period, the cleaner's
 * and the client's job). Every other id is made up on purpose: a stale or
 * mistyped link must show "not found" or send the person somewhere sensible,
 * never a crash screen.
 *
 * This is the check that would have caught the 2026-11-12 crash screen in
 * front of Olha on a page nobody had a test for.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { addBooking } from "../db/harness";
import { getStack, openAs, read, type Screen, type Stack } from "./stack";
import { company, daysFromNow, job, type Company } from "./world";

const APP_DIR = fileURLToPath(new URL("../../src/app", import.meta.url));

type Who = "owner" | "cleaner" | "client" | "nobody";
type Target = { route: string; file: string; who: Who };

function pages(): Target[] {
  const out: Target[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") {
        const file = p.slice(APP_DIR.length + 1).replace(/\\/g, "/");
        const route =
          "/" +
          file
            .replace(/\/?page\.tsx$/, "")
            .split("/")
            .filter((seg) => seg && !/^\(.*\)$/.test(seg))
            .join("/");
        const who: Who = route.startsWith("/app")
          ? "owner"
          : route.startsWith("/field")
            ? "cleaner"
            : file.startsWith("client/(portal)/")
              ? "client"
              : "nobody";
        out.push({ route: route === "/" ? "/" : route, file, who });
      }
    }
  };
  walk(APP_DIR);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

const TARGETS = pages();
const MADE_UP_ID = "00000000-0000-4000-8000-000000000000";

let stack: Stack;
let c: Company;
const ids: Record<string, string> = {};
const screens: Partial<Record<Who, Screen>> = {};

beforeAll(async () => {
  stack = await getStack();
  c = await company(stack, "Crawl");
  const sql = stack.api.sql;
  // A job today with Anna on it, a finished one, and an invoice for it.
  ids.job = await job(stack, c, { at: daysFromNow(0), minutes: 120, crew: [c.anna] });
  const done = await job(stack, c, { at: daysFromNow(-2), minutes: 120, status: "completed", crew: [c.anna] });
  const [inv] = await sql<{ id: string }>(
    `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents, due_date)
     values ($1, $2, $3, 'draft', 14000, current_date + 14) returning id`,
    [c.org, c.client, done],
  );
  await sql(
    `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
     values ($1, $2, 'Standard clean', 1, 14000, $3)`,
    [c.org, inv.id, done],
  );
  ids.invoice = inv.id;
  // The portal: the company's client, signed in.
  const [user] = await sql<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [`crawl-client-${Date.now()}@example.test`, JSON.stringify({ full_name: "Crawl Client" })],
  );
  await sql("update public.clients set profile_id = $2 where id = $1", [c.client, user.id]);
  ids.portalUser = user.id;
  // A visit for the client next week, so the portal has something to show.
  await addBooking(sql, c.org, c.client, { scheduledAt: daysFromNow(7), status: "confirmed" });

  screens.owner = await openAs(stack, c.owner);
  screens.cleaner = await openAs(stack, c.anna, { phone: true });
  screens.client = await openAs(stack, { userId: ids.portalUser, membershipId: "" }, { phone: true });
  const ctx = await stack.browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String((err as Error)?.message ?? err)));
  page.on("dialog", (d) => void d.accept().catch(() => {}));
  screens.nobody = { page, errors, close: () => ctx.close() };
}, 300_000);

afterAll(async () => {
  for (const s of Object.values(screens)) await s?.close().catch(() => {});
});

/** The address to open, and whether its id is a real record. */
function address(t: Target): { url: string; real: boolean } {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const real: Record<string, string> = {
    "/app/bookings/[id]": ids.job,
    "/app/bookings/[id]/edit": ids.job,
    "/app/bookings/[id]/offer": ids.job,
    "/app/clients/[id]": c.client,
    "/app/clients/[id]/edit": c.client,
    "/app/clients/[id]/statement": c.client,
    "/app/invoices/[id]": ids.invoice,
    "/app/invoices/[id]/edit": ids.invoice,
    "/app/employees/[id]": c.anna.membershipId,
    "/app/employees/[id]/edit": c.anna.membershipId,
    "/app/payroll/periods/[range]": `${day(-13)}_${day(0)}`,
    "/field/jobs/[id]": ids.job,
    "/app/help/[slug]": "getting-around",
    "/help/[slug]": "getting-around",
    "/texting/[orgId]/privacy": c.org,
    "/texting/[orgId]/terms": c.org,
  };
  if (t.route in real) {
    const pattern = t.route;
    return { url: pattern.replace(/\[[^\]]+\]/, real[pattern]), real: true };
  }
  // The client's own job, in the portal.
  if (t.route === "/client/jobs/[id]") return { url: `/client/jobs/${ids.job}`, real: true };
  return { url: t.route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, MADE_UP_ID), real: false };
}

async function open(page: Page, url: string): Promise<number> {
  const go = () => page.goto(stack.base + url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // The page before may still be redirecting itself in the browser, which
  // interrupts this navigation (net::ERR_ABORTED). That is the previous
  // page's business; try once more.
  const res = await go().catch(async (err: unknown) => {
    if (!/ERR_ABORTED/.test(String(err))) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return go();
  });
  await page
    .waitForFunction(
      () => {
        if (document.readyState !== "complete") return false;
        const splash = document.querySelector(".sollos-loader") as HTMLElement | null;
        return !splash || splash.offsetParent === null;
      },
      { timeout: 90_000, polling: 200 },
    )
    .catch(() => {});
  // Let the page finish attaching, so an error it throws while doing so is caught.
  await new Promise((r) => setTimeout(r, 500));
  return res?.status() ?? 0;
}

describe("every page, opened by the person who would open it", () => {
  it("found the pages to crawl", () => {
    expect(TARGETS.length).toBeGreaterThan(150);
  });

  for (const t of TARGETS) {
    it(`${t.route} (${t.who})`, async () => {
      const screen = screens[t.who]!;
      screen.errors.length = 0;
      const { url, real } = address(t);
      const status = await open(screen.page, url);
      const text = await read(screen.page).catch(() => "");
      const where = `${url} as ${t.who} → ${screen.page.url().replace(stack.base, "")} (HTTP ${status})`;
      expect(/Something went wrong/i.test(text), `crash screen at ${where}:\n${text.slice(0, 600)}`).toBe(false);
      expect(screen.errors, `the page threw at ${where}`).toEqual([]);
      expect(status, `server error at ${where}`).toBeLessThan(500);
      if (real) expect(status, `a real record showed "not found" at ${where}`).not.toBe(404);
    });
  }
});
