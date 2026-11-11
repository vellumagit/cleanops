/**
 * A fresh set of product screenshots from the seeded demo org.
 *
 *   pnpm screenshots                       # Velluma on sollos3.com
 *   pnpm screenshots -- --base http://localhost:3000
 *   pnpm screenshots -- --org <uuid> --full --only dashboard,field-today
 *
 * Signs in as two demo people the seed creates (scripts/seed-demo-org.ts):
 * Dana, the manager, for the office at 1440×900, and Noah, a cleaner, for
 * the field app at phone size. No password is typed anywhere: the service
 * key mints a one-time sign-in token (generateLink, which sends no email)
 * and the browser redeems it at /auth/callback, the same route a magic link
 * uses. Only demo-domain addresses are accepted, so this can never sign in
 * as a real person.
 *
 * Drives the Chrome (or Edge) already installed on the machine through
 * puppeteer-core; nothing is downloaded. Override with CHROME_PATH.
 *
 * Pictures land in screenshots/<YYYY-MM-DD>/ (git-ignored), named in the
 * order a buyer would see them. Best taken mid-afternoon Edmonton time,
 * right after a reseed: some of today's jobs finished, some running, and a
 * live item on the Needs-you list.
 *
 * Read-only apart from what opening a page does anyway (a chat thread is
 * marked read, a notification badge clears).
 */
import { createClient } from "@supabase/supabase-js";
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- config ----
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(name);

const VELLUMA = "a3045620-b777-4892-bd69-931225c31a1c";
const ORG_ID = opt("--org") ?? VELLUMA;
const BASE = (opt("--base") ?? "https://sollos3.com").replace(/\/+$/, "");
const FULL_PAGE = flag("--full");
const ONLY = opt("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const TZ = "America/Edmonton";
const DEMO_ROOT_DOMAIN = "sollos-demo.local";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run with --env-file=.env.local)");
  process.exit(2);
}
const db = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const T0 = Date.now();
/** A progress line with seconds since start, so a stall shows where it is. */
function log(msg: string) {
  console.log(`  [${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s] ${msg}`);
}

function fail(what: string, err?: unknown): never {
  const msg = err && typeof err === "object" && "message" in err ? (err as { message: string }).message : err;
  console.error(`✗ ${what}${msg ? `: ${msg}` : ""}`);
  process.exit(1);
}

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean) as string[];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) fail("no Chrome or Edge found; set CHROME_PATH");
  return hit;
}

// -------------------------------------------------------------- the org ----
type Ids = {
  orgName: string;
  danaEmail: string;
  noahEmail: string;
  runningJobId: string | null;
  overdueInvoiceId: string | null;
  carterClientId: string | null;
  noahJobId: string | null;
  generalThreadId: string | null;
};

/** Today in the org's zone as [startIso, endIso]. Regina = Edmonton's clock from 2026-11-01. */
function todayWindow(): [string, string] {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Regina" });
  const start = new Date(`${ymd}T06:00:00.000Z`); // 00:00 at UTC-6
  return [start.toISOString(), new Date(start.getTime() + 86_400_000 - 1).toISOString()];
}

async function loadIds(): Promise<Ids> {
  const { data: org, error } = await db.from("organizations").select("id, name").eq("id", ORG_ID).maybeSingle();
  if (error || !org) fail("org lookup", error ?? `no org ${ORG_ID}`);

  const { data: members } = await db
    .from("memberships")
    .select("id, display_name, contact_email")
    .eq("organization_id", ORG_ID)
    .eq("status", "active");
  const byFirst = (first: string) =>
    (members ?? []).find((m) => (m.contact_email ?? "").toLowerCase().startsWith(`${first}@`) && (m.contact_email ?? "").endsWith(DEMO_ROOT_DOMAIN));
  const dana = byFirst("dana");
  const noah = byFirst("noah");
  if (!dana || !noah) fail("demo people", `"${org.name}" has no seeded Dana/Noah — run pnpm seed -- --org ${ORG_ID} --reset first`);

  const [start, end] = todayWindow();
  const { data: today } = await db
    .from("bookings")
    .select("id, status, scheduled_at")
    .eq("organization_id", ORG_ID)
    .gte("scheduled_at", start)
    .lte("scheduled_at", end)
    .order("scheduled_at");
  const running = (today ?? []).find((b) => b.status === "in_progress") ?? (today ?? []).find((b) => b.status === "completed") ?? (today ?? [])[0];

  const { data: overdue } = await db.from("invoices").select("id").eq("organization_id", ORG_ID).eq("status", "overdue").limit(1).maybeSingle();
  const { data: carter } = await db.from("clients").select("id").eq("organization_id", ORG_ID).ilike("name", "Carter%").limit(1).maybeSingle();

  const todayIds = (today ?? []).map((b) => b.id);
  let noahJobId: string | null = null;
  if (todayIds.length > 0) {
    const { data: mine } = await db.from("booking_assignees").select("booking_id").eq("membership_id", noah.id).in("booking_id", todayIds).limit(1).maybeSingle();
    noahJobId = mine?.booking_id ?? null;
  }
  const { data: general } = await db.from("chat_threads").select("id").eq("organization_id", ORG_ID).eq("name", "general").limit(1).maybeSingle();

  return {
    orgName: org.name,
    danaEmail: dana.contact_email!,
    noahEmail: noah.contact_email!,
    runningJobId: running?.id ?? null,
    overdueInvoiceId: overdue?.id ?? null,
    carterClientId: carter?.id ?? null,
    noahJobId,
    generalThreadId: general?.id ?? null,
  };
}

// ----------------------------------------------------------- signing in ----
async function signIn(ctx: BrowserContext, email: string, next: string, viewport: Parameters<Page["setViewport"]>[0], mobile: boolean): Promise<Page> {
  if (!email.endsWith(DEMO_ROOT_DOMAIN)) fail("refusing", `${email} is not a demo address`);
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) fail(`sign-in token for ${email}`, error);

  log(`sign-in token minted for ${email}`);
  const page = await ctx.newPage();
  await preparePage(page, viewport, mobile);
  const url = `${BASE}/auth/callback?token_hash=${encodeURIComponent(hash)}&type=magiclink&next=${encodeURIComponent(next)}`;
  await go(page, url);
  const landed = new URL(page.url()).pathname;
  if (landed.startsWith("/login") || landed.startsWith("/mfa")) fail(`sign-in as ${email}`, `landed on ${page.url()}`);
  log(`signed in, on ${landed}`);
  return page;
}

async function preparePage(page: Page, viewport: Parameters<Page["setViewport"]>[0], mobile: boolean) {
  await page.setViewport(viewport);
  await page.emulateTimezone(TZ);
  if (mobile) {
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
  }
  // Keep the install banner out of the pictures. (The notifications banner
  // stays hidden because the context denies notification permission.)
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("sollos_pwa_dismissed", String(Date.now()));
    } catch {
      /* private mode */
    }
  });
}

/**
 * Go to a page and wait until it has settled. Not "networkidle": the field
 * app holds a realtime connection open, so the network never goes quiet
 * and that wait times out. Load, then give it up to 8 s to calm down.
 */
async function go(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 8_000 }).catch(() => {});
}

// ---------------------------------------------------------------- shots ----
type Shot = { name: string; path: string | null; note?: string };

/**
 * One shot in its own tab. The tabs share the signed-in context, so the
 * session carries over; a page that crashes or reloads itself (seen on the
 * field job page: "Attempted to use detached Frame") loses only its own
 * picture instead of every one after it.
 */
async function capture(ctx: BrowserContext, view: View, dir: string, shot: Shot, index: number, prefix: string) {
  if (ONLY && !ONLY.includes(shot.name)) return;
  const file = join(dir, `${prefix}-${String(index).padStart(2, "0")}-${shot.name}.png`);
  if (!shot.path) {
    console.log(`  – ${shot.name}: skipped (${shot.note ?? "nothing to show today"})`);
    return;
  }
  const page = await ctx.newPage();
  try {
    await preparePage(page, view.viewport, view.mobile);
    await go(page, `${BASE}${shot.path}`);
    await page.evaluate(() => document.fonts?.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 900)); // let charts and transitions settle
    const landed = new URL(page.url()).pathname;
    if (landed.startsWith("/login")) throw new Error("bounced to /login");
    await page.screenshot({ path: file as `${string}.png`, fullPage: FULL_PAGE });
    log(`✓ ${file.split(/[\\/]/).pop()}`);
  } catch (e) {
    console.log(`  ✗ ${shot.name} (${shot.path}): ${e instanceof Error ? e.message : e}`);
  } finally {
    await page.close().catch(() => {});
  }
}

type View = { viewport: Parameters<Page["setViewport"]>[0]; mobile: boolean };
const OFFICE_VIEW: View = { viewport: { width: 1440, height: 900, deviceScaleFactor: 2 }, mobile: false };
const PHONE_VIEW: View = { viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, mobile: true };

async function main() {
  const ids = await loadIds();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const dir = join(process.cwd(), "screenshots", day);
  mkdirSync(dir, { recursive: true });
  console.log(`"${ids.orgName}" on ${BASE} → ${dir}`);

  const office: Shot[] = [
    { name: "dashboard", path: "/app" },
    { name: "scheduling", path: "/app/scheduling" },
    { name: "calendar", path: "/app/calendar" },
    { name: "bookings", path: "/app/bookings" },
    { name: "job", path: ids.runningJobId ? `/app/bookings/${ids.runningJobId}` : null, note: "no job today" },
    { name: "timesheets", path: "/app/timesheets" },
    { name: "invoices", path: "/app/invoices" },
    { name: "invoice-overdue", path: ids.overdueInvoiceId ? `/app/invoices/${ids.overdueInvoiceId}` : null, note: "no overdue invoice" },
    { name: "clients", path: "/app/clients" },
    { name: "client-carter", path: ids.carterClientId ? `/app/clients/${ids.carterClientId}` : null, note: "no Carter client" },
    { name: "employees", path: "/app/employees" },
    { name: "payroll", path: "/app/payroll" },
    { name: "reviews", path: "/app/reviews" },
    { name: "reports", path: "/app/reports" },
    { name: "estimates", path: "/app/estimates" },
    { name: "chat", path: ids.generalThreadId ? `/app/chat?thread=${ids.generalThreadId}` : "/app/chat" },
  ];
  const field: Shot[] = [
    { name: "field-today", path: "/field" },
    { name: "field-jobs", path: "/field/jobs" },
    { name: "field-job", path: ids.noahJobId ? `/field/jobs/${ids.noahJobId}` : null, note: "Noah has no job today" },
    { name: "field-clock", path: "/field/clock" },
    { name: "field-hours", path: "/field/hours" },
    { name: "field-pay", path: "/field/pay" },
    { name: "field-chat", path: ids.generalThreadId ? `/field/chat?thread=${ids.generalThreadId}` : "/field/chat" },
  ];

  let browser: Browser | null = null;
  try {
    const exe = findChrome();
    log(`launching ${exe}`);
    browser = await puppeteer.launch({
      executablePath: exe,
      headless: true,
      // Chrome's background updater can hold the launch past puppeteer's
      // 30 s default (seen 2026-11-11: "Timed out ... waiting for the WS
      // endpoint", with updater pipe errors in Chrome's log). These flags
      // keep the updater, extensions and background services out of a
      // throwaway profile; with them Chrome 155 launches in about 3 s.
      timeout: 90_000,
      protocolTimeout: 120_000,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-component-update",
        "--disable-background-networking",
        "--disable-gpu",
      ],
    });
    log(`launched ${await browser.version()}`);

    console.log(`\nOffice, as ${ids.danaEmail} (1440×900)`);
    const officeCtx = await browser.createBrowserContext();
    await officeCtx.overridePermissions(BASE, []); // every permission denied, notifications included
    const officeLogin = await signIn(officeCtx, ids.danaEmail, "/app", OFFICE_VIEW.viewport, OFFICE_VIEW.mobile);
    await officeLogin.close().catch(() => {});
    for (const [i, s] of office.entries()) await capture(officeCtx, OFFICE_VIEW, dir, s, i + 1, "office");
    await officeCtx.close().catch(() => {});

    console.log(`\nField app, as ${ids.noahEmail} (phone 390×844)`);
    const fieldCtx = await browser.createBrowserContext();
    await fieldCtx.overridePermissions(BASE, []);
    const fieldLogin = await signIn(fieldCtx, ids.noahEmail, "/field", PHONE_VIEW.viewport, PHONE_VIEW.mobile);
    await fieldLogin.close().catch(() => {});
    for (const [i, s] of field.entries()) await capture(fieldCtx, PHONE_VIEW, dir, s, i + 1, "phone");
    await fieldCtx.close().catch(() => {});
  } finally {
    // On Windows the temp profile's lockfile can still be held for a moment
    // after Chrome exits (EBUSY on unlink). The pictures are already saved.
    await browser?.close().catch(() => {});
  }
  console.log(`\nDone. Open ${dir}`);
}

main().catch((e) => fail("screenshots", e));
