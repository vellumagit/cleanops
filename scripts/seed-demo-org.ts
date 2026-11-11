/**
 * Fill one organization with a believable cleaning company, end to end.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-demo-org.ts --org <uuid> [--reset] [--i-mean-it]
 *
 * Two jobs, one script:
 *   - Production: the demo orgs ("Velluma", "sollos demo co") are what a
 *     prospective buyer sees, and the place Brian tries things by hand.
 *     --reset wipes the org's rows and rebuilds them before a demo.
 *   - CI: the seam tests seed a fresh org on Supabase's local stack and play
 *     taps against it (slice 5/6 of docs/finish-plan-2026-10-28.md).
 *
 * What it shows (Brian's 2026-11-11 brief): an operation big enough to be
 * worth paying for. Nine people, ten clients, about forty jobs a week and
 * ~$6,000 of weekly revenue, so the dashboard reads roughly: today 6 jobs /
 * $1,100 (the revenue card counts finished jobs, so it fills in through the
 * day); this week ~$5,800; outstanding invoices ~$2,400 with one overdue;
 * satisfaction 4.8 from 64 reviews in the last 30 days, with Noah at 4.9
 * from 22.
 *
 * Everything is dated from today in the org's zone, so the org is always
 * "live": eight weeks of finished work behind on a fixed weekly template
 * (every rolling week sums the same), four weeks booked ahead, a job in
 * progress right now, a finished job with no price, a visit that drifted
 * from its series, a shift auto-closed and flagged, a cleaner with hours but
 * no pay rate, a prepayment waiting, a voided invoice whose job is released,
 * invoices in every state, a lead with an estimate out, a portal request,
 * tasks, chat, training, inventory, PTO.
 *
 * Real writers are used where the data would otherwise be a forgery:
 * generateOccurrences makes the series visits, wallClockColumns stamps the
 * typed time, preparePayPeriod builds the pay runs from the shifts. The rest
 * are plain rows in the shape the app writes.
 *
 * Names: every person and client is invented, and none shares a first or
 * last name with anyone in Svit Company's roster or client list as of
 * 2026-11-11 (checked by hand against the live lists; keep it that way when
 * editing the cast).
 *
 * Safety: refuses an org whose name doesn't say demo/test/sandbox unless
 * --i-mean-it is given; --reset deletes only rows of that organization and
 * only the auth users this script created (its own per-org email domain;
 * a user who is also in another org loses only this org's membership).
 */
import { createClient } from "@supabase/supabase-js";
import { generateOccurrences, type SeriesRule } from "@/lib/recurrence";
import { wallClockColumns } from "@/lib/scheduled-local";
import { zonedWallClockUtc, zonedYmd } from "@/lib/wall-clock";
import { suggestedPayPeriod } from "@/lib/pay-schedule";

// ---------------------------------------------------------------- config ----
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ORG_ID = opt("--org");
const RESET = flag("--reset");
const I_MEAN_IT = flag("--i-mean-it");
if (!ORG_ID) {
  console.error("Usage: seed-demo-org.ts --org <uuid> [--reset] [--i-mean-it]");
  process.exit(2);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}
const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

/** The org's zone, as stored on every visit. */
const TZ = "America/Edmonton";
/**
 * The zone used to turn "9:00" into an instant. Alberta stopped changing its
 * clocks on 2026-11-01; a machine with older tzdata (Brian's laptop, Node
 * 24.19 / tzdata 2026b) still reads Edmonton as UTC-7 in winter and would
 * seed every visit an hour late — see memory/alberta-permanent-utc-6. Regina
 * has been UTC-6 forever, which is what Edmonton is from Nov 1 and was all
 * summer, so it is right for every date this seed touches.
 */
const Z = "America/Regina";
const DEMO_ROOT_DOMAIN = "sollos-demo.local";
const DEMO_PASSWORD = "demo-cleaner-2026";

// ----------------------------------------------------------------- time -----
const NOW = new Date();
const todayYmd = zonedYmd(NOW, Z);
/** The wall clock `hhmm` on today+`days`, as an instant. */
function at(days: number, hhmm: string): Date {
  const d = new Date(NOW.getTime() + days * 86_400_000);
  return zonedWallClockUtc(zonedYmd(d, Z), hhmm, Z);
}
const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => zonedYmd(d, Z);
const minutes = (n: number) => n * 60_000;
const money = (dollars: number) => Math.round(dollars * 100);
/** 0 = Sunday … 6 = Saturday, for the day `days` from today, in Z. */
function dow(days: number): number {
  const [y, m, d] = ymd(new Date(NOW.getTime() + days * 86_400_000)).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/** The typed time, stored in the org's zone; computed in Z (same clock). */
function wallClock(instant: Date) {
  const local = `${zonedYmd(instant, Z)}T${instant.toLocaleTimeString("en-GB", { timeZone: Z, hour: "2-digit", minute: "2-digit" })}`;
  return { ...wallClockColumns(local, Z), scheduled_tz: TZ };
}

// -------------------------------------------------------------- helpers -----
function fail(what: string, err: unknown): never {
  console.error(`✗ ${what}:`, err && typeof err === "object" && "message" in err ? (err as { message: string }).message : err);
  process.exit(1);
}
type Row = Record<string, unknown>;
type Inserted = { id: string } & Row;
async function insert(table: string, rows: Row[] | Row, select = "id"): Promise<Inserted[]> {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) return [];
  const out: Inserted[] = [];
  // PostgREST is happiest with a few hundred rows per request; the order of
  // the returned rows matches the order sent, which callers rely on.
  // defaultToNull:false → a key one row has and another lacks takes the
  // column default (reminder_count 0, created_at now()) instead of NULL.
  for (let i = 0; i < list.length; i += 150) {
    const chunk = list.slice(i, i + 150);
    const { data, error } = await db.from(table).insert(chunk as never, { defaultToNull: false }).select(select);
    if (error) fail(`${table} insert`, error);
    out.push(...((data ?? []) as unknown as Inserted[]));
  }
  return out;
}
async function update(table: string, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from(table).update(patch as never).eq("id", id);
  if (error) fail(`${table} update`, error);
}
const step = (s: string) => console.log(`\n▸ ${s}`);

// ------------------------------------------------------------------ main ----
async function main() {
  const { data: orgRow, error: orgErr } = await db
    .from("organizations")
    .select("id, name, contact_email, contact_phone")
    .eq("id", ORG_ID!)
    .maybeSingle();
  if (orgErr || !orgRow) fail("org lookup", orgErr ?? "not found");
  const org = orgRow as { id: string; name: string; contact_email: string | null; contact_phone: string | null };
  if (!/demo|test|sandbox/i.test(org.name) && !I_MEAN_IT) {
    fail("refusing", `"${org.name}" doesn't look like a demo org. Pass --i-mean-it if it is.`);
  }
  // One email domain per org, so two demo orgs never share an auth user and
  // resetting one cannot remove a person from the other.
  const slug = org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
  const DEMO_DOMAIN = `${slug}.${DEMO_ROOT_DOMAIN}`;
  console.log(`Seeding "${org.name}" (${org.id}) as of ${todayYmd} ${TZ}; demo logins @${DEMO_DOMAIN}`);

  const { data: ownerRow } = await db
    .from("memberships")
    .select("id, profile_id")
    .eq("organization_id", org.id)
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!ownerRow) fail("owner", "the org has no active owner; sign up first");
  const owner = ownerRow.id as string;

  // ------------------------------------------------------------ reset ----
  if (RESET) {
    step("Reset: removing this org's data");
    // audit_log is append-only by trigger; the tenant eraser's purge
    // function is the one sanctioned way through it.
    for (;;) {
      const { data: removed, error } = await db.rpc("purge_org_audit_log" as never, { p_org: org.id, p_limit: 5000 } as never);
      if (error) fail("reset audit_log", error);
      if (!removed || Number(removed) < 5000) break;
    }
    const tables = [
      "notifications", "needs_you_state",
      "invoice_payments", "invoice_line_items", "booking_prepayments", "invoices",
      "subcontractor_pay_items", "subcontractor_pay_runs", "payroll_items", "payroll_runs",
      "time_entries", "booking_checklist_items", "booking_assignees", "reviews", "booking_requests",
      "bookings", "booking_series",
      "estimate_line_items", "estimates", "tasks", "pto_requests", "availability_slots",
      "chat_messages", "chat_thread_members", "chat_threads", "feedback_items",
      "training_assignments", "training_steps", "training_modules", "inventory_items",
      "checklist_template_items", "checklist_templates", "client_properties", "clients",
      "service_types", "packages", "bonus_rules",
    ];
    for (const t of tables) {
      const { error } = await db.from(t).delete().eq("organization_id", org.id);
      if (error) fail(`reset ${t}`, error);
    }
    const { data: members } = await db
      .from("memberships")
      .select("id, profile_id, role")
      .eq("organization_id", org.id)
      .neq("id", owner);
    for (const m of members ?? []) {
      if (!m.profile_id) continue;
      const { data: u } = await db.auth.admin.getUserById(m.profile_id as string);
      const email = u?.user?.email ?? "";
      const isDemoUser = email.endsWith(`@${DEMO_DOMAIN}`) || email.endsWith(`@${DEMO_ROOT_DOMAIN}`) || email.endsWith(`.${DEMO_ROOT_DOMAIN}`);
      if (!isDemoUser) continue;
      await db.from("memberships").delete().eq("id", m.id);
      const { count } = await db
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", m.profile_id as string);
      // Still someone else's demo person (the other demo org): keep the login.
      if ((count ?? 0) === 0) await db.auth.admin.deleteUser(m.profile_id as string);
    }
  }

  // ------------------------------------------------------- org settings ----
  step("Organization settings");
  {
    const { data: cur } = await db.from("organizations").select("automation_settings").eq("id", org.id).single();
    const settings = { ...((cur?.automation_settings as Record<string, unknown>) ?? {}) };
    for (const k of ["divide_crew_hours", "no_clock_in_alert", "job_not_started_nudge", "booking_assignment_notify", "shift_clock_out_reminder", "auto_complete_past_bookings", "stale_estimate_alert", "shift_confirm_reminder"]) {
      settings[k] = { enabled: true };
    }
    settings["auto_void_overdue_invoices"] = { enabled: false };
    await update("organizations", org.id, {
      timezone: TZ,
      currency_code: "CAD",
      pay_schedule: "semimonthly",
      pay_anchor: null,
      booking_auto_complete_hours: 4,
      invoice_void_days: 365,
      default_tax_rate_bps: 500,
      default_tax_label: "GST",
      // A real org's own contact details stay; only an empty one gets the demo's.
      contact_email: org.contact_email || `office@${DEMO_DOMAIN}`,
      contact_phone: org.contact_phone || "+1 780 555 0100",
      automation_settings: settings,
      onboarding_completed_at: iso(NOW),
      // A demo org's trial must never run out mid-demo.
      billing_override: "comp",
      billing_override_at: iso(NOW),
      billing_override_note: "Demo organization (seed-demo-org.ts).",
    });
  }

  // --------------------------------------------------------------- people ----
  step("People");
  type Person = { id: string; name: string; first: string; role: "manager" | "employee"; engagement: "employee" | "subcontractor"; rate: number | null };
  const cast: Array<Omit<Person, "id">> = [
    { name: "Dana Whitfield", first: "Dana", role: "manager", engagement: "employee", rate: 2900 },
    { name: "Noah Bergström", first: "Noah", role: "employee", engagement: "employee", rate: 2300 },
    { name: "Aisha Rahman", first: "Aisha", role: "employee", engagement: "employee", rate: 2200 },
    { name: "Carlos Mendes", first: "Carlos", role: "employee", engagement: "subcontractor", rate: 2600 },
    { name: "Emily Tran", first: "Emily", role: "employee", engagement: "employee", rate: 2200 },
    { name: "Jordan Blake", first: "Jordan", role: "employee", engagement: "employee", rate: 2100 },
    { name: "Fatima El-Sayed", first: "Fatima", role: "employee", engagement: "subcontractor", rate: 2500 },
    { name: "Liam O'Connor", first: "Liam", role: "employee", engagement: "employee", rate: 2300 },
    { name: "Grace Nakamura", first: "Grace", role: "employee", engagement: "subcontractor", rate: null },
  ];
  const people: Record<string, Person> = {};
  for (const p of cast) {
    const email = `${p.first.toLowerCase()}@${DEMO_DOMAIN}`;
    let userId: string | undefined;
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (error) {
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 500 });
      userId = list?.users.find((u) => u.email === email)?.id;
      if (!userId) fail(`auth user ${email}`, error);
    } else {
      userId = created.user!.id;
    }
    await db.from("profiles").update({ full_name: p.name, phone: `+1 780 555 01${String(Object.keys(people).length + 1).padStart(2, "0")}` } as never).eq("id", userId!);
    const { data: existing } = await db.from("memberships").select("id").eq("organization_id", org.id).eq("profile_id", userId!).maybeSingle();
    let membershipId = existing?.id as string | undefined;
    const row = {
      organization_id: org.id,
      profile_id: userId,
      role: p.role,
      status: "active",
      display_name: p.name,
      contact_email: email,
      pay_type: "hourly",
      pay_rate_cents: p.rate,
      engagement: p.engagement,
      calendar_scope: "mine",
    };
    if (membershipId) await update("memberships", membershipId, row);
    else membershipId = (await insert("memberships", row))[0].id;
    people[p.first] = { ...p, id: membershipId };
  }
  const P = (first: string) => people[first].id;
  const dana = P("Dana");
  const byId = new Map(Object.values(people).map((p) => [p.id, p]));
  const cleaners = ["Noah", "Aisha", "Carlos", "Emily", "Jordan", "Fatima", "Liam", "Grace"];

  // ---------------------------------------------------- services & packs ----
  step("Services, packages, checklist, bonus rule");
  const svcRows = await insert("service_types", [
    { organization_id: org.id, category: "standard", name: "Standard clean", default_duration_minutes: 180, default_price_cents: money(150), color: "#2563eb", sort_order: 1, is_active: true, created_by: owner },
    { organization_id: org.id, category: "deep", name: "Deep clean", default_duration_minutes: 300, default_price_cents: money(320), color: "#7c3aed", sort_order: 2, is_active: true, created_by: owner },
    { organization_id: org.id, category: "move_out", name: "Move in / move out", default_duration_minutes: 600, default_price_cents: money(725), color: "#db2777", sort_order: 3, is_active: true, created_by: owner },
    { organization_id: org.id, category: "recurring", name: "Commercial clean", default_duration_minutes: 180, default_price_cents: money(150), color: "#059669", sort_order: 4, is_active: true, created_by: owner },
    { organization_id: org.id, category: "walkthrough", name: "Walkthrough / quote", default_duration_minutes: 30, default_price_cents: 0, color: "#d97706", sort_order: 5, is_active: true, created_by: owner },
    { organization_id: org.id, category: "meeting", name: "Meeting", default_duration_minutes: 60, default_price_cents: 0, color: "#6b7280", sort_order: 6, is_active: true, created_by: owner },
  ], "id, category, name");
  const svc = Object.fromEntries(svcRows.map((s) => [s.category as string, { id: s.id, label: s.name as string }]));

  await insert("packages", [
    { organization_id: org.id, name: "Basic", description: "Kitchen, bathrooms, floors.", price_cents: money(120), duration_minutes: 120, included: ["Kitchen", "Bathrooms", "Floors"], is_active: true },
    { organization_id: org.id, name: "Standard", description: "Basic plus dusting, bedrooms and inside the microwave.", price_cents: money(150), duration_minutes: 180, included: ["Kitchen", "Bathrooms", "Floors", "Dusting", "Bedrooms"], is_active: true },
    { organization_id: org.id, name: "Deep", description: "Everything, including baseboards, inside the oven and fridge, and windows inside.", price_cents: money(320), duration_minutes: 300, included: ["Everything in Standard", "Baseboards", "Oven", "Fridge", "Interior windows"], is_active: true },
  ]);

  const [tmpl] = await insert("checklist_templates", { organization_id: org.id, name: "Standard clean", description: "What every standard clean covers.", applies_to_service_type: "standard", applies_to_service_type_id: svc.standard.id, is_active: true });
  const checklist = [
    ["pre", "section", "Before you start"], ["pre", "item", "Text the client you're 10 minutes out"], ["pre", "item", "Photo of entry area"],
    ["during", "section", "Kitchen"], ["during", "item", "Counters and backsplash"], ["during", "item", "Sink and taps"], ["during", "item", "Stovetop and front of appliances"],
    ["during", "section", "Bathrooms"], ["during", "item", "Toilet, tub, shower"], ["during", "item", "Mirror and vanity"],
    ["during", "section", "Living areas"], ["during", "item", "Dust surfaces"], ["during", "item", "Vacuum and mop floors"],
    ["post", "section", "Before you leave"], ["post", "item", "Photos of each finished room"], ["post", "item", "Lights off, door locked"],
  ] as const;
  const tmplItems = await insert("checklist_template_items", checklist.map(([phase, kind, title], i) => ({ organization_id: org.id, template_id: tmpl.id, ordinal: i, title, phase, kind, is_required: kind === "item" })), "id, title, phase, kind, ordinal");

  await insert("bonus_rules", { organization_id: org.id, enabled: true, min_avg_rating: 4.5, min_reviews_count: 3, period_days: 30, amount_cents: money(50) });

  // -------------------------------------------------------------- clients ----
  step("Clients");
  type ClientSeed = { key: string; name: string; address: string; email?: string; phone?: string; cadence?: "on_demand" | "biweekly" | "monthly"; billing_type?: "itemized" | "flat_rate"; flat?: number; lifecycle?: "lead" | "client"; lead_stage?: string; lead_source?: string; notes?: string; company?: string };
  const clientSeeds: ClientSeed[] = [
    { key: "gill", name: "Harpreet & Simran Gill", address: "10415 Saskatchewan Dr NW, Edmonton, AB T6E 4S1", email: `gills@${DEMO_DOMAIN}`, phone: "+1 780 555 0201", cadence: "on_demand", notes: "Key in the lockbox by the side door. Two cats — keep the balcony door shut." },
    { key: "nowak", name: "The Nowak Family", address: "8640 112 St NW, Edmonton, AB T6G 2C5", email: `nowaks@${DEMO_DOMAIN}`, phone: "+1 780 555 0202", cadence: "on_demand", notes: "Garage code 4471. Dog (Biscuit) is friendly but will try to leave." },
    { key: "riverbend", name: "Riverbend Dental", company: "Riverbend Dental Clinic Ltd.", address: "5124 Riverbend Rd NW, Edmonton, AB T6H 5K5", email: `office@riverbend-dental.${DEMO_DOMAIN}`, phone: "+1 780 555 0203", cadence: "monthly", billing_type: "flat_rate", flat: money(1280), notes: "Evenings only, after 6 PM. Alarm code with Dana." },
    { key: "delaney", name: "Marcus Delaney", address: "11524 43 Ave NW, Edmonton, AB T6J 0Y3", email: `marcus@${DEMO_DOMAIN}`, phone: "+1 780 555 0204", cadence: "on_demand" },
    { key: "yoga", name: "Whyte Ave Yoga", company: "Whyte Ave Yoga Inc.", address: "10350 82 Ave NW, Edmonton, AB T6E 1Z8", email: `studio@whyteaveyoga.${DEMO_DOMAIN}`, phone: "+1 780 555 0205", cadence: "monthly", billing_type: "flat_rate", flat: money(440) },
    { key: "varma", name: "Sunita Varma", address: "9420 58 St NW, Edmonton, AB T6B 1G4", email: `sunita@${DEMO_DOMAIN}`, phone: "+1 780 555 0206", cadence: "on_demand", notes: "Scent-free products only." },
    { key: "mulligan", name: "Tom & Beth Mulligan", address: "1005 Burns Close NW, Edmonton, AB T6R 2W1", email: `mulligans@${DEMO_DOMAIN}`, phone: "+1 780 555 0207", cadence: "on_demand" },
    { key: "physio", name: "Northgate Physio", company: "Northgate Physiotherapy Ltd.", address: "9499 137 Ave NW, Edmonton, AB T5E 5R8", email: `admin@northgatephysio.${DEMO_DOMAIN}`, phone: "+1 780 555 0208", cadence: "monthly", billing_type: "flat_rate", flat: money(1120), notes: "After 7 PM Tue/Thu. Treatment rooms first, reception last." },
    { key: "carter", name: "Carter Property Management", company: "Carter Property Management Inc.", address: "4211 106 St NW, Edmonton, AB T6J 2S4", email: `alyssa@carterpm.${DEMO_DOMAIN}`, phone: "+1 780 555 0209", cadence: "on_demand", notes: "Alyssa books move-outs for ~40 rental units. Send the invoice to accounts@ as well." },
    { key: "westmount", name: "Westmount Law Office", company: "Westmount Law LLP", address: "10180 101 St NW, Edmonton, AB T5J 3S4", email: `office@westmountlaw.${DEMO_DOMAIN}`, phone: "+1 780 555 0210", lifecycle: "lead", lead_stage: "quoted", lead_source: "Website", notes: "Nightly office clean for 2 floors; quoted, meeting Thursday." },
  ];
  const clientRows = await insert("clients", clientSeeds.map((c) => ({
    organization_id: org.id,
    name: c.name,
    company_name: c.company ?? null,
    address: c.address,
    email: c.email ?? null,
    phone: c.phone ?? null,
    preferred_contact: "email",
    notes: c.notes ?? null,
    billing_cadence: c.cadence ?? "on_demand",
    billing_type: c.billing_type ?? "itemized",
    flat_rate_cents: c.flat ?? null,
    lifecycle: c.lifecycle ?? "client",
    lead_stage: c.lifecycle === "lead" ? c.lead_stage : null,
    lead_source: c.lead_source ?? null,
  })), "id, name");
  const C: Record<string, { id: string; name: string; address: string }> = {};
  clientSeeds.forEach((c, i) => { C[c.key] = { id: clientRows[i].id, name: c.name, address: c.address }; });

  await insert("client_properties", [
    { organization_id: org.id, client_id: C.riverbend.id, label: "Riverbend clinic", address: C.riverbend.address, access_notes: "Alarm panel left of the back door." },
    { organization_id: org.id, client_id: C.riverbend.id, label: "Terwillegar clinic", address: "2051 Leger Rd NW, Edmonton, AB T6R 0R9", access_notes: "Key from the pharmacy next door." },
    { organization_id: org.id, client_id: C.carter.id, label: "Unit 304 — 10883 Saskatchewan Dr", address: "10883 Saskatchewan Dr NW #304, Edmonton, AB T6E 4S6", access_notes: "Fob at the Carter office; return same day." },
    { organization_id: org.id, client_id: C.carter.id, label: "Unit 12 — Rutherford townhomes", address: "1403 Rutherford Rd SW #12, Edmonton, AB T6W 0B7", access_notes: "Lockbox 2290 on the gas meter." },
  ]);

  // ----------------------------------------------------------- bookings -----
  step("Bookings: series, eight weeks of history, today, four weeks ahead");
  type Crew = string[]; // membership ids; first is the lead
  type Billing = "paid" | "sent" | "overdue" | "draft" | "void" | "none";
  type BookingSeed = {
    client: string; when: Date; minutes: number; svc: keyof typeof svc; price: number; crew: Crew;
    status?: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
    notes?: string; series_id?: string; is_free?: boolean; divide?: boolean;
    /** How the finished job is billed; undefined = the default rule. */
    billing?: Billing;
    /** Shift options for a finished job. */
    shift?: { jitter?: number; autoClosed?: boolean; manualBy?: string; none?: boolean; open?: boolean };
  };
  const bookings: Array<BookingSeed & { id: string }> = [];
  const pendingBookings: BookingSeed[] = [];

  /** A job today: finished if its window has passed, running if inside it, booked if ahead. */
  function todayStatus(when: Date, mins: number): "confirmed" | "in_progress" | "completed" {
    const end = new Date(when.getTime() + minutes(mins));
    if (NOW >= end) return "completed";
    if (NOW >= when) return "in_progress";
    return "confirmed";
  }

  function queue(b: BookingSeed) {
    pendingBookings.push(b);
  }

  // The database refuses a cleaner booked in two places at once (the
  // overlap guard, migration 20261108060000), counting each person for the
  // job's full length. The weekly template is laid out so nobody collides;
  // one-off jobs ask who is actually free.
  function isBusy(memberId: string, start: Date, mins: number): boolean {
    const s = start.getTime();
    const e = s + minutes(mins);
    return [...bookings, ...pendingBookings].some(
      (b) => b.status !== "cancelled" && b.crew.includes(memberId) && b.when.getTime() < e && b.when.getTime() + minutes(b.minutes) > s,
    );
  }
  function freeOn(start: Date, mins: number, n: number, prefer: string[] = cleaners): string[] {
    const ids = prefer.map(P).filter((id) => !isBusy(id, start, mins)).slice(0, n);
    if (ids.length < n) console.log(`  (only ${ids.length} of ${n} cleaners free at ${start.toISOString()})`);
    return ids;
  }

  /** A finished job's shifts: each crew member clocks in near the start and out near her share's end. */
  function shiftRows(bookingId: string, b: BookingSeed): Row[] {
    const opts = b.shift ?? {};
    if (opts.none) return [];
    const crew = b.crew;
    const share = b.divide && crew.length > 1 ? Math.round(b.minutes / crew.length) : b.minutes;
    return crew.map((m, i) => {
      const person = byId.get(m)!;
      const inAt = new Date(b.when.getTime() + minutes((opts.jitter ?? 0) + (i === 0 ? -4 : 3) + i));
      let outAt: Date | null = new Date(inAt.getTime() + minutes(share + (i % 2 === 0 ? 11 : -7)));
      if (opts.open) outAt = null;
      const row: Row = {
        organization_id: org.id, employee_id: m, booking_id: bookingId,
        clock_in_at: iso(inAt), clock_out_at: outAt ? iso(outAt) : null,
        pay_rate_cents_snapshot: person.rate, engagement_snapshot: person.engagement,
        needs_review: false, created_manually: false,
      };
      if (opts.autoClosed && i === 0) {
        outAt = new Date(b.when.getTime() + minutes(share + 60));
        row.clock_out_at = iso(outAt);
        row.auto_closed_at = iso(outAt);
        row.needs_review = true;
        row.reminder_count = 2;
        row.last_reminder_at = iso(new Date(outAt.getTime() - minutes(30)));
      }
      if (opts.manualBy) {
        row.created_manually = true;
        row.created_by = opts.manualBy;
        row.notes = "Entered by the office — phone died on site.";
      }
      return row;
    });
  }

  /** Write everything queued: bookings, then their crews, then their shifts, in bulk. */
  async function flush() {
    const list = pendingBookings.splice(0);
    const rows = await insert("bookings", list.map((b) => {
      const status = b.status ?? (b.when < NOW ? "completed" : "confirmed");
      return {
        organization_id: org.id,
        client_id: C[b.client].id,
        address: C[b.client].address,
        scheduled_at: iso(b.when),
        ...wallClock(b.when),
        duration_minutes: b.minutes,
        service_type: b.svc,
        service_type_id: svc[b.svc].id,
        service_type_label: svc[b.svc].label,
        assigned_to: b.crew[0] ?? null,
        status,
        total_cents: b.price,
        is_free: b.is_free ?? false,
        divide_hours_evenly: b.divide ?? false,
        notes: b.notes ?? null,
        series_id: b.series_id ?? null,
        created_at: iso(new Date(Math.min(NOW.getTime(), b.when.getTime() - 7 * 86_400_000))),
      };
    }));
    const assignees: Row[] = [];
    const shifts: Row[] = [];
    list.forEach((b, i) => {
      const status = b.status ?? (b.when < NOW ? "completed" : "confirmed");
      const id = rows[i].id;
      bookings.push({ ...b, status, id });
      b.crew.forEach((m, j) => assignees.push({
        organization_id: org.id, booking_id: id, membership_id: m, is_primary: j === 0,
        acceptance_status: status === "pending" ? "pending" : "accepted",
        responded_at: status === "pending" ? null : iso(new Date(b.when.getTime() - 5 * 86_400_000)),
      }));
      if (status === "completed" || status === "in_progress") shifts.push(...shiftRows(id, b));
    });
    await insert("booking_assignees", assignees);
    await insert("time_entries", shifts);
  }

  // Series ---------------------------------------------------------------
  type SeriesSeed = { client: string; pattern: SeriesRule["pattern"]; custom_days?: number[]; time: string; minutes: number; svc: keyof typeof svc; price: number; crew: Crew; startDays: number; notes?: string };
  const seriesSeeds: SeriesSeed[] = [
    { client: "nowak", pattern: "weekly", time: "09:00", minutes: 150, svc: "standard", price: money(130), crew: [P("Aisha")], startDays: -56, notes: "Garage code 4471." },
    { client: "gill", pattern: "bi_weekly", time: "13:00", minutes: 180, svc: "standard", price: money(150), crew: [P("Emily")], startDays: -55 },
    { client: "riverbend", pattern: "custom_weekly", custom_days: [1, 3], time: "18:00", minutes: 240, svc: "recurring", price: money(160), crew: [P("Carlos"), P("Jordan")], startDays: -54 },
    { client: "yoga", pattern: "weekly", time: "07:00", minutes: 90, svc: "recurring", price: money(110), crew: [P("Liam")], startDays: -53 },
    { client: "physio", pattern: "custom_weekly", custom_days: [2, 4], time: "18:30", minutes: 180, svc: "recurring", price: money(140), crew: [P("Fatima")], startDays: -52 },
  ];
  const horizon = at(28, "23:59");
  let driftVisit: string | null = null;
  const seriesSpecial: { flaggedId?: string } = {};
  for (const s of seriesSeeds) {
    const startsAt = ymd(at(s.startDays, s.time));
    const rule: SeriesRule = {
      pattern: s.pattern, custom_days: s.custom_days ?? null, start_time: s.time, starts_at: startsAt, ends_at: null,
      generate_ahead: 60, monthly_nth: null, monthly_dow: null, tz: Z,
    };
    const [series] = await insert("booking_series", {
      organization_id: org.id, client_id: C[s.client].id, pattern: s.pattern, custom_days: s.custom_days ?? null,
      start_time: `${s.time}:00`, generate_ahead: 8, duration_minutes: s.minutes, service_type: s.svc,
      service_type_id: svc[s.svc].id, service_type_label: svc[s.svc].label, assigned_to: s.crew[0],
      crew: s.crew.length > 1 ? s.crew.map((m) => ({ membership_id: m, start_offset_minutes: null, duration_minutes: null })) : null,
      total_cents: s.price, address: C[s.client].address, notes: s.notes ?? null, starts_at: startsAt, active: true,
    });
    // Today's visits are hand-placed below, so the day reads exactly as
    // briefed; the series simply has no occurrence today.
    const occurrences = generateOccurrences(rule, 60, null)
      .filter((o) => new Date(o) <= horizon)
      .filter((o) => ymd(new Date(o)) !== todayYmd);
    const past = occurrences.filter((o) => new Date(o) < NOW);
    const latestPast = past[past.length - 1];
    let n = 0;
    for (const o of occurrences) {
      const when = new Date(o);
      n++;
      // One visit skipped by the client; one future visit the office moved an
      // hour, which the series-drift check will ask about.
      const cancelled = s.client === "nowak" && n === 3;
      const seed: BookingSeed = {
        client: s.client, when, minutes: s.minutes, svc: s.svc, price: s.price, crew: s.crew, series_id: series.id,
        notes: `[Recurring]${s.notes ? ` ${s.notes}` : ""}`, divide: s.crew.length > 1,
        status: cancelled ? "cancelled" : when < NOW ? "completed" : "confirmed",
        shift: { jitter: (n * 7) % 9 - 4 },
      };
      if (seed.status === "completed" && o === latestPast && s.client === "nowak") {
        // The most recent Nowak visit was never clocked out of.
        seed.shift = { autoClosed: true };
      }
      queue(seed);
    }
  }
  await flush();
  {
    const nowakFlagged = bookings.find((b) => b.client === "nowak" && b.shift?.autoClosed);
    if (nowakFlagged) seriesSpecial.flaggedId = nowakFlagged.id;
    const drift = bookings.find((b) => b.client === "nowak" && b.series_id && b.when > at(10, "00:00"));
    if (drift) {
      await update("bookings", drift.id, { scheduled_at: iso(new Date(drift.when.getTime() + minutes(60))) });
      driftVisit = drift.id;
    }
  }

  // The weekly template ---------------------------------------------------
  // One-off work on a fixed pattern per weekday (0 = Sunday … 6 = Saturday),
  // repeated for the eight weeks behind and the four ahead. Because the
  // pattern is fixed, every rolling seven days sums to about the same
  // revenue (~$6,000 with the series), which is what the dashboard's
  // "this week" card shows no matter which day the seed runs.
  type TemplateJob = [client: string, time: string, minutes: number, svc: keyof typeof svc, price: number, crew: string[], divide?: boolean, notes?: string];
  const template: Record<number, TemplateJob[]> = {
    1: [
      ["delaney", "09:00", 180, "standard", 150, ["Noah"]],
      ["varma", "09:30", 180, "standard", 160, ["Emily"]],
      ["carter", "10:00", 480, "move_out", 480, ["Grace", "Liam"], true, "Unit turnover — keys from the Carter office."],
      ["nowak", "13:00", 180, "standard", 150, ["Fatima"]],
    ],
    2: [
      ["carter", "09:00", 180, "standard", 150, ["Jordan"]],
      ["varma", "13:00", 300, "deep", 320, ["Noah", "Aisha"], true],
      ["delaney", "14:00", 180, "standard", 150, ["Liam"]],
    ],
    3: [
      ["mulligan", "09:00", 180, "standard", 150, ["Noah"]],
      ["carter", "09:30", 600, "move_out", 725, ["Grace", "Fatima", "Liam"], true, "Full move-out, oven and fridge included."],
      ["delaney", "13:30", 180, "standard", 150, ["Emily"]],
    ],
    4: [
      ["delaney", "09:00", 180, "standard", 150, ["Noah"]],
      ["nowak", "10:00", 300, "deep", 340, ["Jordan", "Aisha"], true],
      ["carter", "13:00", 480, "move_out", 480, ["Grace", "Carlos"], true],
    ],
    5: [
      ["varma", "09:00", 180, "standard", 160, ["Noah"]],
      ["carter", "10:00", 180, "standard", 150, ["Emily"]],
      ["mulligan", "13:00", 180, "standard", 150, ["Liam"]],
      ["carter", "14:00", 180, "standard", 160, ["Jordan"]],
      ["nowak", "13:30", 300, "deep", 320, ["Aisha", "Fatima"], true],
    ],
    6: [
      ["gill", "10:00", 300, "deep", 320, ["Noah", "Grace"], true],
      ["delaney", "10:00", 180, "standard", 150, ["Aisha"]],
      ["carter", "11:00", 180, "standard", 160, ["Jordan"]],
      ["mulligan", "13:00", 180, "standard", 150, ["Emily"]],
    ],
  };
  // The latest past Tuesday's deep clean was keyed in by the office.
  let lastTuesday = -1;
  for (let d = -1; d >= -7; d--) if (dow(d) === 2) { lastTuesday = d; break; }
  for (let d = -56; d <= 28; d++) {
    if (d === 0) continue; // today is hand-placed
    if (d === 1) continue; // tomorrow is the big move-out, with a real crew
    for (const [client, time, mins, s, price, crewFirst, divide, notes] of template[dow(d)] ?? []) {
      const manual = d === lastTuesday && client === "varma" && s === "deep";
      queue({
        client, when: at(d, time), minutes: mins, svc: s, price: money(price), crew: crewFirst.map(P), divide: divide ?? false,
        notes: notes ?? undefined, shift: manual ? { manualBy: dana } : { jitter: ((d * 7 + mins) % 9) - 4 },
      });
    }
  }
  await flush();
  // A few one-offs around the template: a walkthrough for the lead, a job
  // cancelled by the client, yesterday's finished job that still has no price.
  queue({ client: "westmount", when: at(-9, "11:00"), minutes: 30, svc: "walkthrough", price: 0, crew: [dana], is_free: true, billing: "none" });
  queue({ client: "mulligan", when: at(-10, "15:30"), minutes: 180, svc: "standard", price: money(150), crew: [P("Liam")], status: "cancelled", notes: "Client away — rebooked.", billing: "none" });
  queue({ client: "delaney", when: at(-1, "15:00"), minutes: 180, svc: "standard", price: 0, crew: freeOn(at(-1, "15:00"), 180, 1, ["Noah", "Liam", "Emily", "Jordan", "Aisha", "Grace", "Carlos", "Fatima"]), notes: "Extra: inside the fridge and the oven. Price to be set.", billing: "none" });
  await flush();

  // Today ------------------------------------------------------------------
  // Six jobs, $1,100. Statuses follow the clock, so a morning demo shows the
  // first ones finished and one running; by evening the revenue card reads
  // the full $1,100.
  const todayJobs: Array<Omit<BookingSeed, "status">> = [
    { client: "nowak", when: at(0, "07:30"), minutes: 150, svc: "standard", price: money(130), crew: [P("Aisha")], notes: "Garage code 4471." },
    { client: "delaney", when: at(0, "08:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Noah")] },
    { client: "varma", when: at(0, "08:30"), minutes: 180, svc: "standard", price: money(160), crew: [P("Emily")], notes: "Scent-free products only." },
    { client: "carter", when: at(0, "09:00"), minutes: 300, svc: "deep", price: money(320), crew: [P("Grace"), P("Liam")], divide: true, notes: "Unit 304 — tenant moved out Sunday." },
    { client: "mulligan", when: at(0, "12:30"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jordan")] },
    { client: "gill", when: at(0, "13:00"), minutes: 240, svc: "standard", price: money(190), crew: [P("Fatima")], notes: "Bigger clean this time: guests arriving Friday." },
  ];
  let inProgressId: string | null = null;
  for (const j of todayJobs) {
    const status = todayStatus(j.when, j.minutes);
    queue({ ...j, status, shift: status === "in_progress" ? { open: true } : { jitter: 2 }, billing: status === "completed" ? "draft" : "none" });
  }
  await flush();
  {
    const running = bookings.find((b) => ymd(b.when) === todayYmd && b.status === "in_progress");
    if (running) {
      inProgressId = running.id;
      const lead = running.crew[0];
      await insert("booking_checklist_items", tmplItems.map((it) => ({
        organization_id: org.id, booking_id: running.id, source_template_id: tmpl.id,
        ordinal: it.ordinal, title: it.title, phase: it.phase, kind: it.kind, is_required: it.kind === "item",
        checked_at: it.phase === "pre" || (it.phase === "during" && (it.ordinal as number) < 7) ? iso(new Date(running.when.getTime() + minutes(10 + (it.ordinal as number) * 6))) : null,
        checked_by: it.phase === "pre" || (it.phase === "during" && (it.ordinal as number) < 7) ? lead : null,
      })));
    }
  }

  // Ahead, beyond the template -------------------------------------------------
  queue({ client: "carter", when: at(1, "09:00"), minutes: 600, svc: "move_out", price: money(725), crew: freeOn(at(1, "09:00"), 600, 3, ["Grace", "Liam", "Noah", "Jordan", "Aisha", "Emily", "Carlos", "Fatima"]), divide: true, notes: "Unit 12 Rutherford. Landlord inspection Friday. Oven and fridge included." });
  queue({ client: "varma", when: at(5, "09:00"), minutes: 180, svc: "standard", price: money(160), crew: freeOn(at(5, "09:00"), 180, 1, ["Emily", "Aisha", "Carlos", "Jordan", "Liam", "Noah", "Grace", "Fatima"]), status: "pending" });
  queue({ client: "mulligan", when: at(6, "13:00"), minutes: 180, svc: "standard", price: money(150), crew: [] });
  queue({ client: "westmount", when: at(3, "16:00"), minutes: 60, svc: "meeting", price: 0, crew: [dana], is_free: true, notes: "Go over the estimate in person; bring the commercial checklist." });
  await flush();
  const carterMoveOut = bookings.find((b) => b.client === "carter" && b.svc === "move_out" && ymd(b.when) === ymd(at(1, "09:00")) && b.price === money(725))!;
  const varmaPending = bookings.find((b) => b.status === "pending")!;

  // ------------------------------------------------------------ invoices ----
  step("Invoices, payments, a prepayment, a void");
  const done = bookings.filter((b) => b.status === "completed" && !b.is_free && b.price > 0);
  const monthlyClients = new Set(clientSeeds.filter((c) => c.cadence === "monthly").map((c) => c.key));
  const perJob = done
    .filter((b) => !monthlyClients.has(b.client) && b.billing !== "none")
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  // The open invoices are chosen by hand so the dashboard reads ~$2,400
  // outstanding with exactly one overdue (amounts include 5% GST):
  //   overdue  Sunita Varma deep clean, $320 → $336.00, due 6 days ago
  //   sent     Riverbend Dental, last month flat, $1,280 → $1,344.00
  //   sent     Carter $160 → $168.00 · Carter $150 → $157.50
  //            Marcus Delaney $150 → $157.50 · Mulligans $150 → $157.50
  //            Nowaks $130 → $136.50
  //   = $2,457.00. Everything older is paid; today's finished jobs are drafts.
  const pick = (client: string, price: number, minAgeDays: number, maxAgeDays: number, svcKey?: string) =>
    perJob.filter((b) => b.client === client && b.price === money(price) && (!svcKey || b.svc === svcKey))
      .filter((b) => { const age = (NOW.getTime() - b.when.getTime()) / 86_400_000; return age >= minAgeDays && age <= maxAgeDays; })
      .sort((a, b) => b.when.getTime() - a.when.getTime())[0];
  const forced = new Map<string, Billing>();
  const overdueJob = pick("varma", 320, 18, 26, "deep");
  if (overdueJob) forced.set(overdueJob.id, "overdue");
  for (const [client, price] of [["carter", 160], ["carter", 150], ["delaney", 150], ["mulligan", 150], ["nowak", 130]] as const) {
    const b = pick(client, price, 1, 8);
    if (b) forced.set(b.id, "sent");
  }
  const voidJob = pick("gill", 320, 20, 40, "deep");
  if (voidJob) forced.set(voidJob.id, "void");

  let invoiceCount = 0;
  const counts: Record<string, number> = {};
  for (const b of perJob) {
    const status: Billing = forced.get(b.id) ?? b.billing ?? "paid";
    if (status === "none") continue;
    const issued = new Date(b.when.getTime() + minutes(b.minutes) + minutes(20));
    const due = new Date(issued.getTime() + 14 * 86_400_000);
    const tax = Math.round(b.price * 0.05);
    const isVoid = status === "void";
    const [inv] = await insert("invoices", {
      organization_id: org.id, client_id: C[b.client].id, booking_id: b.id,
      amount_cents: b.price + tax, tax_rate_bps: 500, tax_amount_cents: tax, tax_label: "GST",
      status, due_date: ymd(due), created_at: iso(issued),
      sent_at: status === "draft" ? null : iso(new Date(issued.getTime() + minutes(45))),
      paid_at: status === "paid" ? iso(new Date(issued.getTime() + (2 + (invoiceCount % 5)) * 86_400_000)) : null,
      voided_at: isVoid ? iso(new Date(issued.getTime() + 3 * 86_400_000)) : null,
      notes: isVoid ? "Voided: client disputed the fridge extra; rebook agreed." : null,
    });
    invoiceCount++;
    counts[status] = (counts[status] ?? 0) + 1;
    await insert("invoice_line_items", {
      organization_id: org.id, invoice_id: inv.id, booking_id: b.id,
      label: `${svc[b.svc].label} — ${b.when.toLocaleDateString("en-CA", { timeZone: Z, month: "short", day: "numeric" })}`,
      quantity: 1, unit_price_cents: b.price, sort_order: 0,
    });
    if (isVoid) {
      await update("bookings", b.id, { billing_released_at: iso(new Date(issued.getTime() + 3 * 86_400_000)) });
    } else {
      await update("bookings", b.id, { billing_invoice_id: inv.id });
    }
    if (status === "paid") {
      await insert("invoice_payments", {
        organization_id: org.id, invoice_id: inv.id, amount_cents: b.price + tax,
        method: invoiceCount % 3 === 0 ? "card" : invoiceCount % 3 === 1 ? "bank_transfer" : "cash",
        reference: invoiceCount % 3 === 1 ? `e-transfer ${100000 + invoiceCount * 37}` : null,
        received_at: iso(new Date(issued.getTime() + (2 + (invoiceCount % 5)) * 86_400_000)), recorded_by: owner,
      });
    }
  }
  // Monthly flat-rate clients: one invoice per past month. Last month's
  // Riverbend invoice is the big one still out; the others are paid.
  {
    const months: Array<{ start: Date; end: Date; key: string }> = [];
    for (let back = 2; back >= 1; back--) {
      const start = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - back, 1));
      const end = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - back + 1, 1));
      months.push({ start, end, key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}` });
    }
    for (const client of monthlyClients) {
      for (const m of months) {
        const visits = done.filter((b) => b.client === client && b.when >= m.start && b.when < m.end);
        if (visits.length === 0) continue;
        const flat = clientSeeds.find((c) => c.key === client)!.flat!;
        const isLast = m === months[months.length - 1];
        const sub = flat;
        const tax = Math.round(sub * 0.05);
        const status = isLast && client === "riverbend" ? "sent" : "paid";
        const created = new Date(m.end.getTime() + 7 * 3_600_000);
        const [inv] = await insert("invoices", {
          organization_id: org.id, client_id: C[client].id, amount_cents: sub + tax, tax_rate_bps: 500, tax_amount_cents: tax, tax_label: "GST",
          status, due_date: ymd(new Date(m.end.getTime() + 20 * 86_400_000)), created_at: iso(created),
          sent_at: iso(new Date(created.getTime() + 2 * 3_600_000)), billing_period_key: m.key,
          paid_at: status === "paid" ? iso(new Date(created.getTime() + 9 * 86_400_000)) : null,
        });
        await insert("invoice_line_items", visits.map((v, i) => ({
          organization_id: org.id, invoice_id: inv.id, booking_id: v.id,
          label: `${svc[v.svc].label} — ${v.when.toLocaleDateString("en-CA", { timeZone: Z, month: "short", day: "numeric" })}`,
          quantity: 1, unit_price_cents: Math.round(sub / visits.length), sort_order: i,
        })));
        for (const v of visits) await update("bookings", v.id, { billing_invoice_id: inv.id });
        if (status === "paid") {
          await insert("invoice_payments", {
            organization_id: org.id, invoice_id: inv.id, amount_cents: sub + tax, method: "bank_transfer",
            reference: `e-transfer ${200000 + invoiceCount * 11}`, received_at: iso(new Date(created.getTime() + 9 * 86_400_000)), recorded_by: owner,
          });
        }
        invoiceCount++;
        counts[status] = (counts[status] ?? 0) + 1;
      }
    }
  }
  // Money paid before the job.
  await insert("booking_prepayments", {
    organization_id: org.id, booking_id: carterMoveOut.id, client_id: C.carter.id, amount_cents: money(300),
    method: "bank_transfer", reference: "e-transfer 300412", notes: "Deposit for the Rutherford move-out.", received_at: iso(at(-2, "15:00")), recorded_by: owner,
  });

  // ----------------------------------------------------------- pay runs ----
  step("Pay periods: the last complete one prepared, the one before paid");
  {
    const { preparePayPeriod } = await import("@/lib/pay-period");
    const last = suggestedPayPeriod("semimonthly", null, todayYmd, null);
    const prev = previousSemimonthly(last.start);
    for (const [label, p] of [["previous", prev], ["last", { start: last.start, end: last.end }]] as const) {
      const r = await preparePayPeriod({ organizationId: org.id, createdByMembershipId: owner, periodStart: p.start, periodEnd: p.end });
      if (!r.ok) {
        console.log(`  ${label} period ${p.start}..${p.end}: not prepared — ${r.error}`);
        continue;
      }
      console.log(`  ${label} period ${p.start}..${p.end}: prepared (employees ${(r.payroll?.totalCents ?? 0) / 100}, contractors ${(r.contractor?.totalCents ?? 0) / 100})`);
      if (label === "previous") {
        const paidAt = iso(zonedWallClockUtc(p.end, "17:00", Z));
        for (const t of ["payroll_runs", "subcontractor_pay_runs"]) {
          await db.from(t).update({ status: "paid", paid_at: paidAt } as never).eq("organization_id", org.id).eq("period_start", p.start).eq("period_end", p.end);
        }
      }
    }
  }

  // ------------------------------------------------- estimates & requests ---
  step("Estimates, portal request, tasks");
  const [estSent] = await insert("estimates", { organization_id: org.id, client_id: C.westmount.id, service_description: "Nightly office clean, two floors (reception, 6 offices, boardroom, 2 washrooms, kitchenette). Mon–Fri after 7 PM.", status: "sent", total_cents: money(2860), sent_at: iso(at(-8, "16:00")), expires_at: ymd(at(22, "00:00")), created_at: iso(at(-9, "12:00")) });
  await insert("estimate_line_items", [
    { organization_id: org.id, estimate_id: estSent.id, label: "Nightly clean, 2 hours × 22 nights", quantity: 44, unit_price_cents: money(60), kind: "labour", sort_order: 0 },
    { organization_id: org.id, estimate_id: estSent.id, label: "Supplies and consumables", quantity: 1, unit_price_cents: money(220), kind: "supplies", sort_order: 1 },
  ]);
  const [estDraft] = await insert("estimates", { organization_id: org.id, client_id: C.varma.id, service_description: "Monthly standard clean, 3 hours, scent-free.", status: "draft", total_cents: money(160), created_at: iso(at(-1, "10:00")) });
  await insert("estimate_line_items", { organization_id: org.id, estimate_id: estDraft.id, label: "Standard clean", quantity: 1, unit_price_cents: money(160), kind: "labour", sort_order: 0 });
  const [estApproved] = await insert("estimates", { organization_id: org.id, client_id: C.carter.id, service_description: "Move-out clean, Unit 12 Rutherford: 10 hours with three cleaners, oven and fridge.", status: "approved", total_cents: money(725), sent_at: iso(at(-6, "11:00")), decided_at: iso(at(-5, "09:00")), created_at: iso(at(-6, "10:00")) });
  await insert("estimate_line_items", { organization_id: org.id, estimate_id: estApproved.id, label: "Move-out clean", quantity: 10, unit_price_cents: money(72.5), kind: "labour", sort_order: 0 });
  await update("bookings", carterMoveOut.id, { estimate_id: estApproved.id });

  await insert("booking_requests", { organization_id: org.id, client_id: C.mulligan.id, service_type: "Deep clean", preferred_date: ymd(at(7, "00:00")), preferred_time_window: "morning", address: C.mulligan.address, notes: "Before the in-laws arrive. Windows inside if possible.", status: "pending" });

  await insert("tasks", [
    { organization_id: org.id, created_by: owner, assigned_to: dana, title: "Order microfibre cloths and two mop heads", due_at: iso(at(-1, "17:00")), notes: "Stock is below threshold." },
    { organization_id: org.id, created_by: owner, assigned_to: dana, title: "Send Alyssa (Carter) the November unit schedule", due_at: iso(at(0, "16:00")) },
    { organization_id: org.id, created_by: dana, assigned_to: owner, title: "Renew liability insurance", due_at: iso(at(-12, "12:00")), completed_at: iso(at(-13, "15:00")) },
    { organization_id: org.id, created_by: owner, assigned_to: dana, title: "Weekly supply check", due_at: iso(at(3, "09:00")), recurrence: "weekly" },
    { organization_id: org.id, created_by: owner, assigned_to: owner, title: "Follow up Westmount Law after Thursday's meeting", due_at: iso(at(4, "10:00")) },
  ]);

  // -------------------------------------------------------------- reviews ----
  // 64 reviews in the last 30 days, average 4.8; Noah 4.9 from 22 (20 fives,
  // 2 fours); everyone else 6 each with at least one 4, so Noah is top.
  step("Reviews");
  const fives = ["Spotless, thank you!", "Great job on the oven.", "Always reliable.", "Love coming home on cleaning day.", "Fantastic as usual.", "The bathrooms have never looked this good.", "Quick, quiet and thorough.", "Tenant inspection passed first time — thank you.", "Even did the window tracks.", "Friendly and careful with the furniture.", "Right on time, every time.", "Best clean we've had."];
  const fours = ["Arrived a bit late but the work was excellent.", "Bathrooms perfect, kitchen floor could use another pass.", "Good clean; missed under the bed.", "Very good, would like the same person next time."];
  const three = "Missed the baseboards this time.";
  const plan: Array<[first: string, ratings: number[]]> = [
    ["Noah", [5, 5, 5, 5, 5, 4, 5, 5, 5, 5, 5, 5, 5, 4, 5, 5, 5, 5, 5, 5, 5, 5]],
    ["Aisha", [5, 5, 5, 5, 4, 4]],
    ["Carlos", [5, 5, 5, 5, 5, 4]],
    ["Emily", [5, 5, 5, 5, 4, 4]],
    ["Jordan", [5, 5, 5, 5, 5, 3]],
    ["Fatima", [5, 5, 5, 5, 4, 4]],
    ["Liam", [5, 5, 5, 5, 5, 4]],
    ["Grace", [5, 5, 5, 5, 5, 4]],
  ];
  const reviewRows: Row[] = [];
  const reviewed = new Set<string>();
  let fi = 0, qi = 0;
  const cutoff = at(-29, "00:00");
  for (const [first, ratings] of plan) {
    const leadId = P(first);
    const mine = done
      .filter((b) => b.crew[0] === leadId && b.when >= cutoff && !reviewed.has(b.id))
      .sort((a, b) => b.when.getTime() - a.when.getTime());
    if (mine.length < ratings.length) console.log(`  (only ${mine.length} recent jobs led by ${first}; wanted ${ratings.length})`);
    ratings.forEach((rating, i) => {
      const b = mine[i];
      if (!b) return;
      reviewed.add(b.id);
      reviewRows.push({
        organization_id: org.id, booking_id: b.id, client_id: C[b.client].id, employee_id: leadId, rating,
        comment: rating === 5 ? fives[fi++ % fives.length] : rating === 4 ? fours[qi++ % fours.length] : three,
        submitted_at: iso(new Date(b.when.getTime() + minutes(b.minutes) + 26 * 3_600_000)),
      });
    });
  }
  await insert("reviews", reviewRows);
  const reviewAvg = reviewRows.reduce((s, r) => s + (r.rating as number), 0) / Math.max(1, reviewRows.length);

  // ------------------------------------------- training, inventory, PTO ---
  step("Training, inventory, PTO, availability, chat, feedback");
  const [mod] = await insert("training_modules", { organization_id: org.id, title: "Chemical safety", description: "Before your first shift.", created_by: owner, status: "published", assign_on_join: true });
  const steps = await insert("training_steps", [
    { organization_id: org.id, module_id: mod.id, ord: 0, body: "Read the product label before use. Never mix chemicals, especially bleach with anything acidic." },
    { organization_id: org.id, module_id: mod.id, ord: 1, body: "Gloves and eye protection for oven cleaner and descalers." },
    { organization_id: org.id, module_id: mod.id, ord: 2, body: "Ventilate: open a window or run the fan whenever you spray." },
  ]);
  await insert("training_assignments", cleaners.map((f, i) => ({
    organization_id: org.id, module_id: mod.id, employee_id: P(f),
    completed_step_ids: i < 6 ? steps.map((s) => s.id) : i === 6 ? [steps[0].id] : [],
    completed_at: i < 6 ? iso(at(-30 + i, "18:00")) : null,
  })));

  await insert("inventory_items", [
    { organization_id: org.id, name: "All-purpose cleaner (4 L)", category: "chemical", quantity: 6, reorder_threshold: 3 },
    { organization_id: org.id, name: "Glass cleaner (1 L)", category: "chemical", quantity: 2, reorder_threshold: 4 },
    { organization_id: org.id, name: "Oven cleaner", category: "chemical", quantity: 3, reorder_threshold: 2 },
    { organization_id: org.id, name: "Microfibre cloths", category: "consumable", quantity: 18, reorder_threshold: 30 },
    { organization_id: org.id, name: "Mop heads", category: "consumable", quantity: 4, reorder_threshold: 4 },
    { organization_id: org.id, name: "Nitrile gloves (box)", category: "consumable", quantity: 7, reorder_threshold: 3 },
    { organization_id: org.id, name: "Vacuum — Miele C3", category: "equipment", quantity: 4, reorder_threshold: 0, assigned_to: P("Noah") },
    { organization_id: org.id, name: "Steam mop", category: "equipment", quantity: 2, reorder_threshold: 0 },
  ]);

  await insert("pto_requests", { organization_id: org.id, employee_id: P("Jordan"), start_date: ymd(at(10, "00:00")), end_date: ymd(at(11, "00:00")), hours: 16, reason: "Family wedding", status: "pending" });

  const avail: Array<Record<string, unknown>> = [];
  for (const f of cleaners) {
    for (const d of [1, 2, 3, 4, 5, 6]) {
      if (d === 6 && !["Noah", "Aisha", "Jordan", "Emily", "Grace"].includes(f)) continue;
      avail.push({ organization_id: org.id, membership_id: P(f), day_of_week: d, start_time: f === "Liam" ? "06:30" : "08:00", end_time: ["Carlos", "Fatima", "Jordan"].includes(f) ? "22:00" : "17:00" });
    }
  }
  await insert("availability_slots", avail);

  const [general] = await insert("chat_threads", { organization_id: org.id, kind: "group", name: "general" });
  const everyone = [owner, ...Object.values(people).map((p) => p.id)];
  await insert("chat_thread_members", everyone.map((m) => ({ organization_id: org.id, thread_id: general.id, membership_id: m })));
  await insert("chat_messages", [
    { organization_id: org.id, thread_id: general.id, sender_id: owner, body: "Welcome to the team chat. Job questions here, anything private to Dana or me directly.", created_at: iso(at(-40, "08:00")) },
    { organization_id: org.id, thread_id: general.id, sender_id: dana, body: "Reminder: Riverbend's alarm code changed. It's in the property notes.", created_at: iso(at(-6, "17:30")) },
    { organization_id: org.id, thread_id: general.id, sender_id: P("Aisha"), body: "The Nowaks left a thank-you card and cookies 🍪", created_at: iso(at(-2, "16:10")) },
    { organization_id: org.id, thread_id: general.id, sender_id: P("Grace"), body: "Heads up — Carter's Rutherford lockbox sticks, push in before you turn.", created_at: iso(at(-1, "11:45")) },
    { organization_id: org.id, thread_id: general.id, sender_id: dana, body: "Rutherford move-out is tomorrow 9:00, three of you. Oven and fridge are in. Photos of every room before you start, please.", created_at: iso(at(0, "07:50")) },
  ]);

  await insert("feedback_items", [
    { organization_id: org.id, kind: "idea", title: "Let me reorder the checklist from my phone", body: "The kitchen section should come before bathrooms for most houses.", status: "open", created_by: P("Aisha"), page_context: "/field/jobs" },
    { organization_id: org.id, kind: "bug", title: "Invoice PDF cut off the GST line on my phone", body: "Only on the small screen. Fine on the laptop.", status: "shipped", created_by: dana, page_context: "/app/invoices" },
  ]);

  // -------------------------------------------------------------- report ----
  const weekStart = at(-6, "00:00");
  const weekDone = bookings.filter((b) => b.status === "completed" && b.when >= weekStart).reduce((s, b) => s + b.price, 0);
  const weekAll = bookings.filter((b) => b.when >= weekStart && b.when <= at(0, "23:59")).reduce((s, b) => s + (b.status === "cancelled" ? 0 : b.price), 0);
  const todayAll = todayJobs.reduce((s, b) => s + b.price, 0);
  console.log(`
Done. "${org.name}" now has:
  people      owner + ${cast.length} (manager Dana; Grace has hours but no pay rate)
  clients     ${clientSeeds.length} (1 lead: Westmount Law; flat monthly: Riverbend, Northgate Physio, Whyte Ave Yoga; Carter PM books the move-outs)
  series      ${seriesSeeds.length}; one Nowak visit drifted an hour → Needs-you Restore/Keep
  bookings    ${bookings.length} (${bookings.filter((b) => b.status === "completed").length} done, ${bookings.filter((b) => b.when > NOW).length} ahead)
  today       ${todayJobs.length} jobs, $${(todayAll / 100).toFixed(0)} booked; ${inProgressId ? "one running now" : "none running at this hour"}; the revenue card counts finished ones
  this week   $${(weekDone / 100).toFixed(0)} finished of $${(weekAll / 100).toFixed(0)} booked (last 7 days incl. today)
  invoices    ${invoiceCount}: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")} → outstanding ≈ $2,457 with 1 overdue
  reviews     ${reviewRows.length} in the last 30 days, average ${reviewAvg.toFixed(2)}; Noah ${plan[0][1].length} at ${(plan[0][1].reduce((a, b) => a + b, 0) / plan[0][1].length).toFixed(2)}
  flags       Aisha's last Nowak shift auto-closed and flagged${seriesSpecial.flaggedId ? "" : " (none)"}; Jordan's PTO pending; an unstaffed Mulligan job next week; a pending Sunita Varma job (${varmaPending.id.slice(0, 8)}); yesterday's Delaney job has no price
  money       $300 deposit on tomorrow's Rutherford move-out
  estimates   sent (Westmount Law, $2,860/month), draft (Sunita Varma), approved (Carter → tomorrow's move-out)
  requests    1 portal request from the Mulligans

Sign in as any demo person: <first name>@${DEMO_DOMAIN} / ${DEMO_PASSWORD}
  (${cast.map((p) => p.first.toLowerCase()).join(", ")})
`);
  void driftVisit;
}

/** The semimonthly period before the one starting on `start` (YYYY-MM-DD). */
function previousSemimonthly(start: string): { start: string; end: string } {
  const [y, m, d] = start.split("-").map(Number);
  if (d === 16) return { start: `${y}-${String(m).padStart(2, "0")}-01`, end: `${y}-${String(m).padStart(2, "0")}-15` };
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return { start: `${py}-${String(pm).padStart(2, "0")}-16`, end: `${py}-${String(pm).padStart(2, "0")}-${lastDay}` };
}

main().catch((e) => fail("seed", e));
