/**
 * A small, labelled set of jobs for testing by hand, added to a demo org.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-test-run.ts --org <uuid>            # says what it would add
 *   ... scripts/seed-test-run.ts --org <uuid> --write                                                              # adds it
 *   ... scripts/seed-test-run.ts --org <uuid> --remove --write                                                     # takes it away again
 *
 * seed-demo-org.ts makes a demo org look like a busy company. This adds one
 * client on top, "Test Run (safe to click)", with exactly the jobs the
 * everyday flows need, so a person (or Claude driving a browser) can click
 * through them on the real site without touching the demo's own books:
 *
 *   1. a job starting now, one cleaner            I'm here / I'm done
 *   2. a job starting now, two cleaners           stays open until both are done
 *   3. a 4-hour job + a later job the same day    two cleaners share the hours (not a double-booking)
 *   4. two jobs at the same time                  a real double-booking is refused in words
 *   5. a job that ended, nobody tapped            Mark complete
 *   6. a job next week                            cancel it
 *   7. a weekly series, four visits ahead         end the series
 *   8. three finished jobs, each with a draft     Add discount; Bill for a period (combine two)
 *
 * Nothing here sends anything: the client has no email and no phone, and
 * the crews are the demo cast (addresses on the demo domain). Rows are
 * written in the shape the app writes them, the way seed-demo-org.ts does.
 *
 * Safety: only an org seed-demo-org.ts has filled (it must have the demo
 * cast), dry by default, and --remove deletes only what hangs off the
 * client named below.
 */
import { createClient } from "@supabase/supabase-js";
import { wallClockColumns } from "@/lib/scheduled-local";
import { zonedWallClockUtc, zonedYmd } from "@/lib/wall-clock";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ORG_ID = opt("--org");
const WRITE = flag("--write");
const REMOVE = flag("--remove");
const SITE = (opt("--site") ?? "https://sollos3.com").replace(/\/+$/, "");
if (!ORG_ID) {
  console.error("Usage: seed-test-run.ts --org <uuid> [--write] [--remove] [--site https://sollos3.com]");
  process.exit(2);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}
const db = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const TEST_CLIENT = "Test Run (safe to click)";
const ADDRESS = "1 Test Run Lane (not a real place)";
const DEMO_ROOT_DOMAIN = "sollos-demo.local";
/** Alberta's clock all year since 2026-11-01, on any machine's zone data (see seed-demo-org.ts). */
const Z = "America/Regina";

/**
 * "Now" is the site's clock, not this machine's: jobs "starting now" on a
 * laptop whose clock is an hour off (Brian's was, 2026-11-15) would be an
 * hour in the future for the cleaner tapping them. Set in main().
 */
let NOW = new Date();
async function siteNow(): Promise<Date> {
  try {
    const res = await fetch(`${SITE}/login`, { method: "HEAD", redirect: "manual" });
    const header = res.headers.get("date");
    const server = header ? new Date(header) : null;
    if (server && Number.isFinite(server.getTime())) {
      const off = Math.round((Date.now() - server.getTime()) / 60_000);
      if (Math.abs(off) >= 2) console.log(`(this computer's clock is ${Math.abs(off)} min ${off > 0 ? "ahead of" : "behind"} ${SITE}; using the site's time)`);
      return server;
    }
  } catch {
    // Offline or blocked: fall back to this machine.
  }
  return new Date();
}
const minutes = (n: number) => n * 60_000;
const iso = (d: Date) => d.toISOString();
function at(days: number, hhmm: string): Date {
  return zonedWallClockUtc(zonedYmd(new Date(NOW.getTime() + days * 86_400_000), Z), hhmm, Z);
}
/** Now, moved by `mins` and rounded down to five minutes. */
function nowPlus(mins: number): Date {
  const t = NOW.getTime() + minutes(mins);
  return new Date(t - (t % minutes(5)));
}
const clock = (d: Date) =>
  d.toLocaleString("en-CA", { timeZone: Z, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function fail(what: string, err: unknown): never {
  console.error(`✗ ${what}:`, err && typeof err === "object" && "message" in err ? (err as { message: string }).message : err);
  process.exit(1);
}
type Row = Record<string, unknown>;
async function insert(table: string, rows: Row[] | Row, select = "id"): Promise<Array<{ id: string } & Row>> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return [];
  const { data, error } = await db.from(table).insert(list as never, { defaultToNull: false }).select(select);
  if (error) fail(`${table} insert`, error);
  return (data ?? []) as unknown as Array<{ id: string } & Row>;
}

async function remove(orgId: string): Promise<void> {
  const { data: clients } = await db.from("clients").select("id").eq("organization_id", orgId).eq("name", TEST_CLIENT);
  const clientIds = (clients ?? []).map((c) => c.id as string);
  if (clientIds.length === 0) {
    console.log("Nothing to remove: no client named " + JSON.stringify(TEST_CLIENT));
    return;
  }
  const { data: jobs } = await db.from("bookings").select("id").eq("organization_id", orgId).in("client_id", clientIds).limit(1000);
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  const { data: invs } = await db.from("invoices").select("id").eq("organization_id", orgId).in("client_id", clientIds).limit(1000);
  const invIds = (invs ?? []).map((i) => i.id as string);
  console.log(`${WRITE ? "Removing" : "Would remove"}: ${clientIds.length} client, ${jobIds.length} job(s), ${invIds.length} invoice(s), and what hangs off them`);
  if (!WRITE) return;
  const del = async (table: string, column: string, ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await db.from(table).delete().eq("organization_id", orgId).in(column, ids);
    if (error) console.error(`  ! ${table}: ${error.message}`);
  };
  await del("invoice_payments", "invoice_id", invIds);
  await del("invoice_line_items", "invoice_id", invIds);
  // Stamps point at the invoices; clear them so the invoices can go.
  if (jobIds.length) await db.from("bookings").update({ billing_invoice_id: null } as never).in("id", jobIds);
  await del("invoices", "id", invIds);
  await del("time_entries", "booking_id", jobIds);
  await del("booking_assignees", "booking_id", jobIds);
  await del("bookings", "id", jobIds);
  await del("booking_series", "client_id", clientIds);
  await del("client_job_requests", "client_id", clientIds);
  await del("clients", "id", clientIds);
  const { count } = await db.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("name", TEST_CLIENT);
  console.log(count ? "✗ the client is still there: something above could not be deleted (a shift on a pay run, most likely)" : "Removed.");
}

async function main() {
  const { data: org, error: orgErr } = await db.from("organizations").select("id, name, timezone").eq("id", ORG_ID!).maybeSingle();
  if (orgErr || !org) fail("org lookup", orgErr ?? "not found");
  console.log(`"${org.name}" (${org.id})${WRITE ? "" : "  — DRY RUN, nothing is written; add --write"}`);
  NOW = await siteNow();

  if (REMOVE) return remove(org.id as string);

  // The demo cast: only an org the demo seed has filled.
  const { data: members } = await db
    .from("memberships")
    .select("id, display_name, role, status, engagement, pay_rate_cents, contact_email")
    .eq("organization_id", org.id)
    .eq("status", "active");
  const cast = ((members ?? []) as Array<{ id: string; display_name: string | null; role: string; engagement: string; pay_rate_cents: number | null; contact_email: string | null }>).filter(
    (m) => (m.contact_email ?? "").endsWith(`.${DEMO_ROOT_DOMAIN}`) && m.role === "employee",
  );
  // Employees with a rate: the taps and the rate change need a payable person.
  // Everyone else on the demo roster (contractors too) can still be crew.
  const employees = cast.filter((m) => m.engagement === "employee" && m.pay_rate_cents != null);
  if (employees.length < 4) fail("demo cast", `only ${employees.length} demo employees here; run seed-demo-org.ts on this org first`);
  const nameOf = new Map(cast.map((m) => [m.id, m.display_name ?? "?"]));
  const emailOf = new Map(cast.map((m) => [m.id, m.contact_email ?? ""]));

  const { data: existing } = await db.from("clients").select("id").eq("organization_id", org.id).eq("name", TEST_CLIENT).limit(1);
  if ((existing ?? []).length > 0) fail("already there", `"${TEST_CLIENT}" exists; remove it first (--remove --write) so the set starts clean`);

  const { data: svcRow } = await db
    .from("service_types")
    .select("id, name, category")
    .eq("organization_id", org.id)
    .eq("category", "standard")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!svcRow) fail("service", "no active Standard service in this org");

  // Who is already booked, so the overlap guard never has to refuse the seed.
  const from = iso(new Date(NOW.getTime() - 6 * 86_400_000));
  const to = iso(new Date(NOW.getTime() + 30 * 86_400_000));
  const busy: Array<{ who: string; start: number; end: number }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("bookings")
      .select("id, scheduled_at, duration_minutes, status, booking_assignees ( membership_id )")
      .eq("organization_id", org.id)
      .neq("status", "cancelled")
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .order("id")
      .range(offset, offset + 999);
    if (error) fail("reading the schedule", error);
    for (const b of (data ?? []) as Array<{ scheduled_at: string; duration_minutes: number; booking_assignees: Array<{ membership_id: string }> }>) {
      const start = Date.parse(b.scheduled_at);
      for (const a of b.booking_assignees ?? []) busy.push({ who: a.membership_id, start, end: start + minutes(b.duration_minutes) });
    }
    if (!data || data.length < 1000) break;
  }
  const isFree = (who: string, start: Date, mins: number) =>
    !busy.some((b) => b.who === who && b.start < start.getTime() + minutes(mins + 30) && b.end > start.getTime() - minutes(30));
  /** Who of these is free for every one of the windows, least-used first. */
  const used = new Map<string, number>();
  type Person = (typeof cast)[number];
  function freeFor(pool: Person[], windows: Array<[Date, number]>): string[] {
    return pool
      .filter((m) => windows.every(([start, mins]) => isFree(m.id, start, mins)))
      .sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0))
      .map((m) => m.id);
  }
  function take(ids: string[], windows: Array<[Date, number]>): string[] {
    for (const id of ids) {
      used.set(id, (used.get(id) ?? 0) + 1);
      for (const [start, mins] of windows) busy.push({ who: id, start: start.getTime(), end: start.getTime() + minutes(mins) });
    }
    return ids;
  }
  /** `n` people free for these exact windows, or stop. */
  function pick(n: number, windows: Array<[Date, number]>, label: string, pool: Person[] = cast): string[] {
    const free = freeFor(pool, windows);
    if (free.length < n) fail(label, `needs ${n} free demo cleaner(s), found ${free.length}`);
    return take(free.slice(0, n), windows);
  }
  /**
   * The first of these days on which `n` people are free for the windows
   * `plan` lays out. The demo company is busy; a fixed day often is not free.
   */
  function slot(
    n: number,
    days: number[],
    plan: (day: number) => Array<[Date, number]>,
    label: string,
    pool: Person[] = cast,
  ): { day: number; crew: string[] } {
    for (const day of days) {
      const windows = plan(day);
      const free = freeFor(pool, windows);
      if (free.length >= n) return { day, crew: take(free.slice(0, n), windows) };
    }
    return fail(label, `no day in the next ${days.length} with ${n} demo cleaner(s) free`);
  }

  type Job = {
    key: string;
    title: string;
    when: Date;
    mins: number;
    crew: string[];
    status: "confirmed" | "completed";
    divide?: boolean;
    price: number;
    shift?: boolean;
    draft?: boolean;
    series?: boolean;
  };
  const jobs: Job[] = [];
  const PRICE = 14000;

  const DAYS_AHEAD = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // 1 + 2: under way now.
  const nowStart = nowPlus(-10);
  jobs.push({ key: "tap_solo", title: "1 · Tap alone (I'm here, I'm done)", when: nowStart, mins: 120, crew: pick(1, [[nowStart, 120]], "tap alone", employees), status: "confirmed", price: PRICE });
  jobs.push({ key: "tap_pair", title: "2 · Two on the job (stays open until both are done)", when: nowStart, mins: 240, divide: true, crew: pick(2, [[nowStart, 240]], "tap pair", employees), status: "confirmed", price: 28000 });

  // 3: the Thursday case. One on a four-hour job at 9:00; the other has a job at 11:30 and is free before it.
  const share = slot(2, DAYS_AHEAD, (d) => [[at(d, "09:00"), 270]], "shared hours");
  const nine = at(share.day, "09:00");
  const elevenThirty = at(share.day, "11:30");
  const [share1, share2] = share.crew;
  jobs.push({ key: "share_morning", title: "3a · Four hours at 9:00, one cleaner (add the second from 3b)", when: nine, mins: 240, divide: true, crew: [share1], status: "confirmed", price: 28000 });
  jobs.push({ key: "share_later", title: "3b · 11:30 the same day (her cleaner goes onto 3a as well)", when: elevenThirty, mins: 120, crew: [share2], status: "confirmed", price: PRICE });

  // 4: a real clash.
  const clash = slot(2, DAYS_AHEAD, (d) => [[at(d, "14:00"), 120]], "clash");
  const two = at(clash.day, "14:00");
  const [clash1, clash2] = clash.crew;
  jobs.push({ key: "clash_a", title: "4a · 2:00 PM (her cleaner is the one to add to 4b)", when: two, mins: 120, crew: [clash1], status: "confirmed", price: PRICE });
  jobs.push({ key: "clash_b", title: "4b · 2:00 PM too (adding 4a's cleaner must be refused in words)", when: two, mins: 120, crew: [clash2], status: "confirmed", price: PRICE });

  // 5: ended an hour ago, nobody tapped.
  const ended = nowPlus(-180);
  jobs.push({ key: "close", title: "5 · Ended an hour ago, nobody tapped (Mark complete)", when: ended, mins: 120, crew: pick(1, [[ended, 120]], "close"), status: "confirmed", price: PRICE });

  // 6: to cancel.
  const cancel = slot(1, DAYS_AHEAD, (d) => [[at(d, "16:30"), 120]], "cancel");
  const cancelAt = at(cancel.day, "16:30");
  jobs.push({ key: "cancel", title: "6 · Next week (cancel it)", when: cancelAt, mins: 120, crew: cancel.crew, status: "confirmed", price: PRICE });

  // 7: a weekly series, four visits ahead, one cleaner free for all four.
  const weekly = slot(1, [6, 7, 8, 9, 10, 11, 12], (d) => [0, 7, 14, 21].map((w) => [at(d + w, "12:00"), 120] as [Date, number]), "series");
  const seriesTimes = [0, 7, 14, 21].map((w) => at(weekly.day + w, "12:00"));
  const seriesCrew = weekly.crew;
  seriesTimes.forEach((when, i) =>
    jobs.push({ key: `series_${i + 1}`, title: `7 · Weekly series, visit ${i + 1} of 4 (end the series)`, when, mins: 120, crew: seriesCrew, status: "confirmed", price: PRICE, series: true }),
  );

  // 8: three finished jobs, one employee, each with its own draft. An
  // employee, because her three unpaid shifts are what a rate change re-prices.
  const doneTimes = [at(-4, "07:00"), at(-3, "07:00"), at(-2, "07:00")];
  const doneCrew = pick(1, doneTimes.map((t) => [t, 150] as [Date, number]), "finished jobs", employees);
  doneTimes.forEach((when, i) =>
    jobs.push({
      key: `done_${i + 1}`,
      title: i === 0 ? "8a · Finished, draft invoice (Add discount)" : `8${i === 1 ? "b" : "c"} · Finished, draft invoice (Bill for a period: combine b and c)`,
      when, mins: 120, crew: doneCrew, status: "completed", price: PRICE, shift: true, draft: true,
    }),
  );

  console.log(`\nClient: ${TEST_CLIENT}  (no email, no phone: nothing can be sent to it)`);
  for (const j of jobs) console.log(`  ${j.title}\n      ${clock(j.when)} · ${j.mins / 60}h · ${j.crew.map((c) => nameOf.get(c)).join(" + ")}`);
  if (!WRITE) {
    console.log("\nDRY RUN: nothing written. Add --write to add these.");
    return;
  }

  // ------------------------------------------------------------- write ----
  const [client] = await insert("clients", {
    organization_id: org.id, name: TEST_CLIENT, address: ADDRESS, email: null, phone: null, preferred_contact: "email",
    notes: "Added by scripts/seed-test-run.ts for testing by hand. Safe to click anything here. Remove with --remove --write.",
    billing_cadence: "on_demand", billing_type: "itemized", lifecycle: "client",
  });
  const wallClock = (instant: Date) => {
    const local = `${zonedYmd(instant, Z)}T${instant.toLocaleTimeString("en-GB", { timeZone: Z, hour: "2-digit", minute: "2-digit" })}`;
    return { ...wallClockColumns(local, Z), scheduled_tz: (org.timezone as string | null) ?? "America/Edmonton" };
  };
  const [series] = await insert("booking_series", {
    organization_id: org.id, client_id: client.id, pattern: "weekly", custom_days: null, start_time: "12:00:00", generate_ahead: 4,
    duration_minutes: 120, service_type: "standard", service_type_id: svcRow.id, service_type_label: svcRow.name, assigned_to: seriesCrew[0], crew: null,
    total_cents: PRICE, address: ADDRESS, notes: "[Test Run] weekly series", starts_at: zonedYmd(seriesTimes[0], Z), active: true,
  });

  const rows = await insert(
    "bookings",
    jobs.map((j) => ({
      organization_id: org.id, client_id: client.id, address: ADDRESS, scheduled_at: iso(j.when), ...wallClock(j.when),
      duration_minutes: j.mins, service_type: "standard", service_type_id: svcRow.id, service_type_label: svcRow.name,
      assigned_to: j.crew[0], status: j.status, total_cents: j.price, is_free: false, divide_hours_evenly: j.divide ?? false,
      notes: `[Test Run] ${j.title}`, series_id: j.series ? series.id : null,
    })),
  );
  const idOf = new Map(jobs.map((j, i) => [j.key, rows[i].id]));
  await insert(
    "booking_assignees",
    jobs.flatMap((j) =>
      j.crew.map((m, i) => ({
        organization_id: org.id, booking_id: idOf.get(j.key)!, membership_id: m, is_primary: i === 0,
        acceptance_status: "accepted", responded_at: iso(NOW),
      })),
    ),
  );
  const rate = new Map(employees.map((m) => [m.id, m.pay_rate_cents]));
  await insert(
    "time_entries",
    jobs.filter((j) => j.shift).flatMap((j) =>
      j.crew.map((m) => ({
        organization_id: org.id, employee_id: m, booking_id: idOf.get(j.key)!,
        clock_in_at: iso(new Date(j.when.getTime() - minutes(3))), clock_out_at: iso(new Date(j.when.getTime() + minutes(j.mins + 6))),
        pay_rate_cents_snapshot: rate.get(m) ?? null, engagement_snapshot: "employee", needs_review: false, created_manually: false,
      })),
    ),
  );
  const invoiceOf = new Map<string, string>();
  for (const j of jobs.filter((x) => x.draft)) {
    const tax = Math.round(j.price * 0.05);
    const [inv] = await insert("invoices", {
      organization_id: org.id, client_id: client.id, booking_id: idOf.get(j.key)!, amount_cents: j.price + tax,
      tax_rate_bps: 500, tax_amount_cents: tax, tax_label: "GST", status: "draft",
      due_date: zonedYmd(new Date(NOW.getTime() + 14 * 86_400_000), Z),
    });
    await insert("invoice_line_items", {
      organization_id: org.id, invoice_id: inv.id, booking_id: idOf.get(j.key)!,
      label: `${svcRow.name} — ${j.when.toLocaleDateString("en-CA", { timeZone: Z, month: "short", day: "numeric" })}`,
      quantity: 1, unit_price_cents: j.price, sort_order: 0,
    });
    const { error } = await db.from("bookings").update({ billing_invoice_id: inv.id } as never).eq("id", idOf.get(j.key)!);
    if (error) fail("stamp", error);
    invoiceOf.set(j.key, inv.id);
  }

  // ------------------------------------------------------------ report ----
  const day = (d: Date) => zonedYmd(d, Z);
  console.log(`\nAdded. Open these on ${SITE}:\n`);
  const link = (key: string) => `${SITE}/app/bookings/${idOf.get(key)}`;
  const who = (key: string) => jobs.find((j) => j.key === key)!.crew.map((c) => `${nameOf.get(c)} <${emailOf.get(c)}>`).join(" + ");
  console.log(`1  Tap alone               ${link("tap_solo")}\n     cleaner: ${who("tap_solo")}`);
  console.log(`2  Two on the job          ${link("tap_pair")}\n     cleaners: ${who("tap_pair")}`);
  console.log(`3  Shared hours            ${link("share_morning")}\n     Change crew → add ${nameOf.get(share2)} → it saves`);
  console.log(`4  Double-booking          ${link("clash_b")}\n     Change crew → add ${nameOf.get(clash1)} → "already booked then", nothing changes`);
  console.log(`5  Mark complete           ${link("close")}`);
  console.log(`6  Cancel                  ${link("cancel")}`);
  console.log(`7  End the series          ${SITE}/app/bookings/series   (row "${TEST_CLIENT}")`);
  console.log(`8a Add discount            ${SITE}/app/invoices/${invoiceOf.get("done_1")}/edit`);
  console.log(`8b Bill for a period       ${SITE}/app/invoices/period?client_id=${client.id}&from=${day(doneTimes[1])}&to=${day(NOW)}`);
  console.log(`   Rate change             ${SITE}/app/employees/${doneCrew[0]}/edit   (${nameOf.get(doneCrew[0])}: three unpaid shifts since ${day(doneTimes[0])})`);
  console.log(`\nCleaner sign-in for 1 and 2: the address above and the demo password seed-demo-org.ts prints (DEMO_PASSWORD in that file).`);
  console.log(`Remove it all:  npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-test-run.ts --org ${org.id} --remove --write`);
}

main().catch((e) => fail("seed-test-run", e));
