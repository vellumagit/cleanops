/**
 * The app in a real browser, against the throwaway database.
 *
 * The unit and database tests check what the code and the database do. They
 * cannot see what a person sees: on 2026-11-12 a double-booking the database
 * rightly refused reached Olha as a crash screen, and nothing failed for five
 * days, because every test stopped at the refusal. These tests click the
 * real screens in Chrome and read what comes back.
 *
 * One stack per run: the in-process Postgres behind PostgREST that the
 * database tests use (test/db/api.ts), `next dev` pointed at it with every
 * real secret blanked (test/db/app-process.ts), and one headless Chrome.
 * Tests arrange their own company through `stack.api.sql`, sign in by
 * setting the session cookie (there is no login server), and drive pages.
 * Nothing here can reach production or send anything.
 *
 * Locally the "cleanops-teststack" preview must be stopped first: Next
 * allows one dev server per project folder.
 */
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import type { ChildProcess } from "node:child_process";
import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer-core";
import { startApi, type Api } from "../db/api";
import { spawnApp } from "../db/app-process";
import type { Member } from "../db/harness";

export type Stack = { api: Api; base: string; browser: Browser };

let child: ChildProcess | null = null;
let appLog = "";

/** The shared stack, started on first use and torn down when the run exits. */
export function getStack(): Promise<Stack> {
  // On globalThis so every test file shares it even if this module is loaded twice.
  const shared = globalThis as { __sollosBrowserStack?: Promise<Stack> };
  shared.__sollosBrowserStack ??= boot();
  return shared.__sollosBrowserStack;
}

function chromePath(): string {
  const hit = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && existsSync(p));
  if (!hit) throw new Error("No Chrome or Edge found for the browser tests; set CHROME_PATH.");
  return hit;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function boot(): Promise<Stack> {
  console.log("[browser-tests] starting the database, the app and Chrome (once per run)");
  const api = await startApi();
  const port = await freePort();
  const base = `http://localhost:${port}`;
  child = spawnApp(api, port, "pipe");
  child.stdout?.on("data", (d) => (appLog = (appLog + String(d)).slice(-20_000)));
  child.stderr?.on("data", (d) => (appLog = (appLog + String(d)).slice(-20_000)));
  const kill = () => {
    if (child && child.exitCode === null) child.kill();
  };
  process.once("exit", kill);
  process.once("SIGINT", () => {
    kill();
    process.exit(130);
  });

  // Ready when the sign-in page answers. The first request compiles it.
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (child.exitCode !== null) {
      const twoServers = /Another next dev server is already running/.test(appLog);
      throw new Error(
        twoServers
          ? "The app would not start: another `next dev` is running in this folder. Stop the cleanops-teststack (or dev) preview, then run the browser tests again."
          : `The app exited before it was ready:\n${appLog.slice(-2000)}`,
      );
    }
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual" });
      if (res.status < 500) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`The app did not answer within 3 minutes:\n${appLog.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-prefers-reduced-motion"],
  });
  process.once("exit", () => void browser.close().catch(() => {}));
  return { api, base, browser };
}

/** The last of what the app printed: for a failing test's message. */
export const recentAppLog = (chars = 1500) => appLog.slice(-chars);

// ---------------------------------------------------------------------------
// A person at a screen
// ---------------------------------------------------------------------------

export type Screen = {
  page: Page;
  /** Uncaught errors the page threw, as they happened. */
  errors: string[];
  close: () => Promise<void>;
};

/**
 * Open the app signed in as this person. Office people get a laptop-sized
 * window, cleaners a phone, which is how each of them uses it.
 */
export async function openAs(
  stack: Stack,
  who: Member,
  opts: { phone?: boolean } = {},
): Promise<Screen> {
  const context = await stack.browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(opts.phone ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String((err as Error)?.message ?? err)));
  // A confirm() is a yes: the tests click what a person would confirm.
  page.on("dialog", (d) => void d.accept().catch(() => {}));
  for (const c of stack.api.sessionCookies(who.userId, `user-${who.userId.slice(0, 8)}@example.test`)) {
    await page.setCookie({ name: c.name, value: c.value, url: stack.base });
  }
  return { page, errors, close: () => context.close() };
}

/** Go to a path and wait until the page is there and its buttons work. */
export async function visit(stack: Stack, page: Page, path: string): Promise<void> {
  await page.goto(stack.base + path, { waitUntil: "domcontentloaded" });
  await settled(page);
}

/**
 * Wait for the page to be usable: the boot splash gone, the document loaded,
 * and React attached (a button clicked before that does nothing).
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      if (document.readyState !== "complete") return false;
      const splash = document.querySelector(".sollos-loader") as HTMLElement | null;
      if (splash && splash.offsetParent !== null) return false;
      const probe = document.querySelector("main button, main a, main input, main select, button, a");
      if (!probe) return false;
      return Object.keys(probe).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    },
    { timeout: 90_000, polling: 150 },
  );
}

/** Everything a person can read on the page. */
export const read = (page: Page): Promise<string> =>
  page.evaluate(() => (document.body as HTMLElement).innerText.replace(/\u00a0/g, " "));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CLICKABLE = "button, a, [role='button'], [role='menuitem'], [role='option'], [role='tab'], summary, label";

/**
 * Find something a person would click, by what it says. A string must be the
 * whole label; a pattern may match part of it. Waits for it to appear, be
 * visible, enabled, and wired up.
 */
export async function find(
  page: Page,
  label: string | RegExp,
  opts: { within?: string; selector?: string; timeout?: number } = {},
): Promise<ElementHandle<Element>> {
  const re = typeof label === "string" ? new RegExp(`^${escapeRe(label)}$`, "i") : label;
  const handle = await page.waitForFunction(
    (selector: string, within: string | null, source: string, flags: string) => {
      const re = new RegExp(source, flags);
      const root = within ? document.querySelector(within) : document;
      if (!root) return null;
      for (const el of root.querySelectorAll(selector)) {
        const h = el as HTMLElement & { disabled?: boolean };
        const said = (h.getAttribute("aria-label") || h.innerText || h.textContent || "").replace(/\s+/g, " ").trim();
        if (!re.test(said)) continue;
        const box = h.getBoundingClientRect();
        const style = getComputedStyle(h);
        if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
        if (h.disabled || h.getAttribute("aria-disabled") === "true") continue;
        return h;
      }
      return null;
    },
    { timeout: opts.timeout ?? 30_000, polling: 150 },
    opts.selector ?? CLICKABLE,
    opts.within ?? null,
    re.source,
    re.flags,
  );
  const el = handle.asElement() as ElementHandle<Element> | null;
  if (!el) throw new Error(`Nothing on the page says ${String(label)}`);
  return el;
}

/** Click what says this. */
export async function click(
  page: Page,
  label: string | RegExp,
  opts: { within?: string; selector?: string; timeout?: number } = {},
): Promise<void> {
  const el = await find(page, label, opts);
  await el.evaluate((n) => (n as HTMLElement).scrollIntoView({ block: "center", inline: "center" }));
  await el.click();
}

/** Wait until the page says this somewhere. Returns the page's text. */
export async function says(page: Page, what: string | RegExp, timeout = 30_000): Promise<string> {
  const re = typeof what === "string" ? new RegExp(escapeRe(what), "i") : what;
  try {
    await page.waitForFunction(
      (source: string, flags: string) =>
        new RegExp(source, flags).test((document.body as HTMLElement).innerText.replace(/\u00a0/g, " ")),
      { timeout, polling: 150 },
      re.source,
      re.flags,
    );
  } catch {
    const now = await read(page);
    throw new Error(`The page never said ${String(what)}. It says:\n${now.slice(0, 1500)}`);
  }
  return read(page);
}

/** Type into a field, replacing what is there. */
export async function fill(page: Page, selector: string, value: string): Promise<void> {
  const el = await page.waitForSelector(selector, { visible: true });
  if (!el) throw new Error(`No field ${selector}`);
  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await el.type(value);
}

/**
 * Set a field to a value the way the browser itself would on input. For date
 * pickers, where what you type depends on the machine's locale: the value is
 * always YYYY-MM-DD.
 */
export async function setValue(page: Page, selector: string, value: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true });
  await page.$eval(
    selector,
    (el, v) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

/** Choose an option in a native dropdown, by its value. */
export async function choose(page: Page, selector: string, value: string): Promise<void> {
  await page.waitForSelector(selector, { visible: true });
  await page.select(selector, value);
}

/**
 * The page is not a crash screen and threw nothing. The app's error
 * boundaries (src/app/app/error.tsx, field/error.tsx, global-error.tsx) all
 * say "Something went wrong"; a person seeing that has hit a bug.
 */
export async function expectNoCrash(screen: Screen): Promise<void> {
  const text = await read(screen.page);
  if (/Something went wrong/i.test(text)) {
    throw new Error(`Crash screen:\n${text.slice(0, 800)}\n--- app log ---\n${recentAppLog()}`);
  }
  // React's hydration mismatch is logged as an uncaught error in dev. It is
  // real when it happens in CI (the server and the browser disagree about
  // what to draw), so it is not filtered out.
  if (screen.errors.length > 0) {
    throw new Error(`The page threw:\n${screen.errors.join("\n").slice(0, 1500)}`);
  }
}
