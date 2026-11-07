/**
 * Fill one organization with a believable cleaning company, end to end.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local scripts/seed-demo-org.ts --org <uuid> [--reset]
 *
 * Two jobs, one script:
 *   - Production: "sollos demo co" is the demo and marketing org, and the place
 *     Brian tries things by hand. --reset wipes it and rebuilds it before a demo.
 *   - CI: the seam tests seed a fresh org on Supabase's local stack and play
 *     taps against it (slice 5/6 of docs/finish-plan-2026-10-28.md).
 *
 * Everything is dated from today in the org's zone, so the org is always
 * "live": eight weeks of finished work behind, four weeks booked ahead, a job
 * in progress right now, one nobody clocked into, a finished job with no
 * price, a visit that drifted from its series, a shift auto-closed and
 * flagged, a cleaner with hours but no pay rate, a prepayment waiting, a
 * voided invoice whose job is released, invoices in every state, a lead with
 * an estimate out, a portal request, tasks, chat, training, inventory, PTO.
 * The dashboard's Needs-you list is full the moment it loads.
 *
 * Real writers are used where the data would otherwise be a forgery:
 * generateOccurrences makes the series visits, wallClockColumns stamps the
 * typed time, preparePayPeriod builds the pay runs from the shifts. The rest
 * are plain rows in the shape the app writes.
 *
 * Safety: refuses an org whose name doesn't say demo/test/sandbox unless
 * --i-mean-it is given; --reset deletes only rows of that organization and
 * only the auth users this script created (its own email domain).
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
const DEMO_DOMAIN = "sollos-demo.local";
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
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const minutes = (n: number) => n * 60_000;
const money = (dollars: number) => Math.round(dollars * 100);
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
  const { data, error } = await db.from(table).insert(list as never).select(select);
  if (error) fail(`${table} insert`, error);
  return (data ?? []) as unknown as Inserted[];
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
    .select("id, name")
    .eq("id", ORG_ID!)
    .maybeSingle();
  if (orgErr || !orgRow) fail("org lookup", orgErr ?? "not found");
  const org = orgRow as { id: string; name: string };
  if (!/demo|test|sandbox/i.test(org.name) && !I_MEAN_IT) {
    fail("refusing", `"${org.name}" doesn't look like a demo org. Pass --i-mean-it if it is.`);
  }
  console.log(`Seeding "${org.name}" (${org.id}) as of ${todayYmd} ${TZ}`);

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
    const tables = [
      "notifications", "needs_you_state", "audit_log",
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
      const { data: u } = await db.auth.admin.getUserById(m.profile_id as string);
      if (u?.user?.email?.endsWith(`@${DEMO_DOMAIN}`)) {
        await db.from("memberships").delete().eq("id", m.id);
        await db.auth.admin.deleteUser(m.profile_id as string);
      }
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
      contact_email: `office@${DEMO_DOMAIN}`,
      contact_phone: "+1 780 555 0100",
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
    { name: "Maria Lopez", first: "Maria", role: "manager", engagement: "employee", rate: 2800 },
    { name: "Olena Shevchenko", first: "Olena", role: "employee", engagement: "employee", rate: 2200 },
    { name: "Daniel Okafor", first: "Daniel", role: "employee", engagement: "subcontractor", rate: 2500 },
    { name: "Priya Nair", first: "Priya", role: "employee", engagement: "subcontractor", rate: 2400 },
    { name: "Jake Thompson", first: "Jake", role: "employee", engagement: "employee", rate: 2100 },
    { name: "Sofia Rossi", first: "Sofia", role: "employee", engagement: "subcontractor", rate: null },
    { name: "Ahmed Hassan", first: "Ahmed", role: "employee", engagement: "employee", rate: 2300 },
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
  const maria = P("Maria");

  // ---------------------------------------------------- services & packs ----
  step("Services, packages, checklist, bonus rule");
  const svcRows = await insert("service_types", [
    { organization_id: org.id, category: "standard", name: "Standard clean", default_duration_minutes: 180, default_price_cents: money(150), color: "#2563eb", sort_order: 1, is_active: true, created_by: owner },
    { organization_id: org.id, category: "deep", name: "Deep clean", default_duration_minutes: 300, default_price_cents: money(320), color: "#7c3aed", sort_order: 2, is_active: true, created_by: owner },
    { organization_id: org.id, category: "move_out", name: "Move in / move out", default_duration_minutes: 600, default_price_cents: money(725), color: "#db2777", sort_order: 3, is_active: true, created_by: owner },
    { organization_id: org.id, category: "recurring", name: "Recurring clean", default_duration_minutes: 120, default_price_cents: money(120), color: "#059669", sort_order: 4, is_active: true, created_by: owner },
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
    { key: "margaret", name: "Margaret Chen", address: "10415 Saskatchewan Dr NW, Edmonton, AB T6E 4S1", email: `margaret@${DEMO_DOMAIN}`, phone: "+1 780 555 0201", cadence: "monthly", notes: "Key under the planter. Two cats — keep the balcony door shut." },
    { key: "harrison", name: "The Harrisons", address: "8640 112 St NW, Edmonton, AB T6G 2C5", email: `harrisons@${DEMO_DOMAIN}`, phone: "+1 780 555 0202", cadence: "on_demand", notes: "Garage code 4471." },
    { key: "riverbend", name: "Riverbend Dental", company: "Riverbend Dental Clinic Ltd.", address: "5124 Riverbend Rd NW, Edmonton, AB T6H 5K5", email: `office@riverbend-dental.${DEMO_DOMAIN}`, phone: "+1 780 555 0203", cadence: "monthly", billing_type: "flat_rate", flat: money(1280), notes: "Evenings only, after 6 PM. Alarm code with Maria." },
    { key: "patel", name: "Sam & Jordan Patel", address: "11524 43 Ave NW, Edmonton, AB T6J 0Y3", email: `patels@${DEMO_DOMAIN}`, phone: "+1 780 555 0204", cadence: "on_demand" },
    { key: "linda", name: "Linda Okonkwo", address: "9420 58 St NW, Edmonton, AB T6B 1G4", email: `linda@${DEMO_DOMAIN}`, phone: "+1 780 555 0205", cadence: "on_demand" },
    { key: "gabriel", name: "Gabriel Moreau", address: "784 Blackburn Pl SW, Edmonton, AB T6W 1A9", email: `gabriel@${DEMO_DOMAIN}`, phone: "+1 780 555 0206", cadence: "on_demand", notes: "Move-out: landlord inspection Friday." },
    { key: "yoga", name: "Whyte Ave Yoga", company: "Whyte Ave Yoga Inc.", address: "10350 82 Ave NW, Edmonton, AB T6E 1Z8", email: `studio@whyteaveyoga.${DEMO_DOMAIN}`, phone: "+1 780 555 0207", cadence: "biweekly" },
    { key: "ferguson", name: "Nancy & Bill Ferguson", address: "1005 Burns Close NW, Edmonton, AB T6R 2W1", email: `fergusons@${DEMO_DOMAIN}`, phone: "+1 780 555 0208", cadence: "on_demand" },
    { key: "tetiana", name: "Tetiana Kovalenko", address: "16505 133 St NW, Edmonton, AB T6V 1L2", email: `tetiana@${DEMO_DOMAIN}`, phone: "+1 780 555 0209", cadence: "on_demand" },
    { key: "chance", name: "Chance Thompson", address: "224 Heagle Cres NW, Edmonton, AB T6R 2A4", email: `chance@${DEMO_DOMAIN}`, phone: "+1 780 555 0210", lifecycle: "lead", lead_stage: "quoted", lead_source: "Website", notes: "Wants a deep clean before listing the house." },
    { key: "watson", name: "Dr. Emily Watson", address: "140 Newcastle Cres, Sherwood Park, AB T8A 5H6", email: `emily@${DEMO_DOMAIN}`, phone: "+1 780 555 0211", cadence: "on_demand" },
    { key: "kyrstie", name: "Kyrstie Green", address: "8520 158A Ave NW, Edmonton, AB T5Z 2W4", email: `kyrstie@${DEMO_DOMAIN}`, phone: "+1 780 555 0212", cadence: "on_demand" },
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
  ]);

  // ----------------------------------------------------------- bookings -----
  step("Bookings: series, history, today, ahead");
  type Crew = string[]; // membership ids; first is the lead
  type BookingSeed = {
    client: string; when: Date; minutes: number; svc: keyof typeof svc; price: number; crew: Crew;
    status?: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled";
    notes?: string; series_id?: string; is_free?: boolean; divide?: boolean;
  };
  const bookings: Array<BookingSeed & { id: string }> = [];

  async function addBooking(b: BookingSeed): Promise<string> {
    const status = b.status ?? (b.when < NOW ? "completed" : "confirmed");
    const [row] = await insert("bookings", {
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
    });
    if (b.crew.length > 0) {
      await insert("booking_assignees", b.crew.map((m, i) => ({
        organization_id: org.id, booking_id: row.id, membership_id: m, is_primary: i === 0,
        acceptance_status: status === "pending" ? "pending" : "accepted",
        responded_at: status === "pending" ? null : iso(new Date(b.when.getTime() - 5 * 86_400_000)),
      })));
    }
    bookings.push({ ...b, status, id: row.id });
    return row.id;
  }

  /** A finished job's shifts: each crew member clocks in near the start and out near her share's end. */
  async function shifts(bookingId: string, b: BookingSeed, opts: { jitter?: number; autoClosed?: boolean; manualBy?: string } = {}) {
    const crew = b.crew;
    const share = b.divide && crew.length > 1 ? Math.round(b.minutes / crew.length) : b.minutes;
    const rows = crew.map((m, i) => {
      const person = Object.values(people).find((p) => p.id === m)!;
      const inAt = new Date(b.when.getTime() + minutes((opts.jitter ?? 0) + (i === 0 ? -4 : 3) + i));
      let outAt = new Date(inAt.getTime() + minutes(share + (i % 2 === 0 ? 11 : -7)));
      const row: Record<string, unknown> = {
        organization_id: org.id, employee_id: m, booking_id: bookingId,
        clock_in_at: iso(inAt), clock_out_at: iso(outAt),
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
    await insert("time_entries", rows);
  }

  // Series ---------------------------------------------------------------
  type SeriesSeed = { client: string; pattern: SeriesRule["pattern"]; custom_days?: number[]; time: string; minutes: number; svc: keyof typeof svc; price: number; crew: Crew; startDays: number; notes?: string };
  const seriesSeeds: SeriesSeed[] = [
    { client: "harrison", pattern: "weekly", time: "09:00", minutes: 120, svc: "standard", price: money(120), crew: [P("Daniel")], startDays: -56, notes: "Garage code 4471." },
    { client: "margaret", pattern: "bi_weekly", time: "13:00", minutes: 180, svc: "standard", price: money(150), crew: [P("Olena")], startDays: -55 },
    { client: "riverbend", pattern: "custom_weekly", custom_days: [1, 3], time: "18:00", minutes: 240, svc: "recurring", price: money(160), crew: [P("Priya"), P("Jake")], startDays: -54 },
    { client: "yoga", pattern: "weekly", time: "07:00", minutes: 90, svc: "recurring", price: money(110), crew: [P("Ahmed")], startDays: -53 },
    { client: "patel", pattern: "monthly", time: "10:00", minutes: 300, svc: "deep", price: money(320), crew: [P("Olena"), P("Sofia")], startDays: -50 },
  ];
  const horizon = at(28, "23:59");
  let driftVisit: string | null = null;
  let flaggedVisit: { id: string; seed: BookingSeed } | null = null;
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
    const occurrences = generateOccurrences(rule, 60, null).filter((o) => new Date(o) <= horizon);
    let n = 0;
    for (const o of occurrences) {
      const when = new Date(o);
      n++;
      // One visit skipped by the client; one future visit the office moved an
      // hour, which the series-drift check will ask about.
      const cancelled = s.client === "harrison" && n === 3;
      const seed: BookingSeed = {
        client: s.client, when, minutes: s.minutes, svc: s.svc, price: s.price, crew: s.crew, series_id: series.id,
        notes: `[Recurring]${s.notes ? ` ${s.notes}` : ""}`, divide: s.crew.length > 1,
        status: cancelled ? "cancelled" : when < NOW ? "completed" : "confirmed",
      };
      const id = await addBooking(seed);
      if (seed.status === "completed") {
        // The most recent Harrisons visit was never clocked out of.
        const isLatestPast = when < NOW && !occurrences.some((x) => new Date(x) > when && new Date(x) < NOW);
        if (s.client === "harrison" && isLatestPast) {
          await shifts(id, seed, { autoClosed: true });
          flaggedVisit = { id, seed };
        } else if (s.client === "patel" && isLatestPast) {
          await shifts(id, seed, { manualBy: maria });
        } else {
          await shifts(id, seed, { jitter: (n * 7) % 9 - 4 });
        }
      }
      if (s.client === "harrison" && when > NOW && !driftVisit && when > at(10, "00:00")) {
        await update("bookings", id, { scheduled_at: iso(new Date(when.getTime() + minutes(60))) });
        driftVisit = id;
      }
    }
  }

  // One-off history --------------------------------------------------------
  const history: BookingSeed[] = [
    { client: "linda", when: at(-48, "09:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")] },
    { client: "ferguson", when: at(-44, "13:00"), minutes: 300, svc: "deep", price: money(320), crew: [P("Olena"), P("Ahmed")], divide: true },
    { client: "kyrstie", when: at(-40, "10:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Priya")] },
    { client: "tetiana", when: at(-37, "09:30"), minutes: 300, svc: "deep", price: money(340), crew: [P("Daniel"), P("Jake")], divide: true },
    { client: "linda", when: at(-31, "09:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")] },
    { client: "watson", when: at(-27, "14:00"), minutes: 30, svc: "walkthrough", price: 0, crew: [maria], is_free: true },
    { client: "kyrstie", when: at(-20, "10:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Priya")] },
    { client: "ferguson", when: at(-16, "13:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Ahmed")] },
    { client: "linda", when: at(-14, "09:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")] },
    { client: "chance", when: at(-9, "11:00"), minutes: 30, svc: "walkthrough", price: 0, crew: [maria], is_free: true },
    { client: "tetiana", when: at(-8, "09:30"), minutes: 180, svc: "standard", price: money(160), crew: [P("Daniel")] },
    { client: "kyrstie", when: at(-1, "10:00"), minutes: 180, svc: "standard", price: 0, crew: [P("Priya")], notes: "Extra: inside the fridge. Price to be set." },
  ];
  const cancelledOne: BookingSeed = { client: "ferguson", when: at(-10, "09:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Ahmed")], status: "cancelled", notes: "Client away — rebooked." };
  for (const h of history) {
    const id = await addBooking(h);
    await shifts(id, h, { jitter: (h.when.getDate() % 7) - 3 });
  }
  await addBooking(cancelledOne);

  // Today ------------------------------------------------------------------
  const noClockIn: BookingSeed = { client: "linda", when: hoursAgo(3), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")], status: "confirmed" };
  const noClockInId = await addBooking(noClockIn);
  const inProgress: BookingSeed = { client: "tetiana", when: hoursAgo(2), minutes: 300, svc: "deep", price: money(340), crew: [P("Olena")], status: "in_progress" };
  const inProgressId = await addBooking(inProgress);
  await insert("time_entries", {
    organization_id: org.id, employee_id: P("Olena"), booking_id: inProgressId,
    clock_in_at: iso(new Date(hoursAgo(2).getTime() + minutes(2))), clock_out_at: null,
    pay_rate_cents_snapshot: people.Olena.rate, engagement_snapshot: "employee", needs_review: false, created_manually: false,
  });
  await insert("booking_checklist_items", tmplItems.map((it) => ({
    organization_id: org.id, booking_id: inProgressId, source_template_id: tmpl.id,
    ordinal: it.ordinal, title: it.title, phase: it.phase, kind: it.kind, is_required: it.kind === "item",
    checked_at: it.phase === "pre" || (it.phase === "during" && (it.ordinal as number) < 7) ? iso(new Date(hoursAgo(2).getTime() + minutes(10 + (it.ordinal as number) * 6))) : null,
    checked_by: it.phase === "pre" || (it.phase === "during" && (it.ordinal as number) < 7) ? P("Olena") : null,
  })));

  // Ahead --------------------------------------------------------------------
  const ahead: BookingSeed[] = [
    { client: "gabriel", when: at(1, "09:00"), minutes: 600, svc: "move_out", price: money(725), crew: [P("Olena"), P("Daniel"), P("Priya")], divide: true, notes: "Landlord inspection Friday. Oven and fridge included." },
    { client: "ferguson", when: at(1, "13:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")] },
    { client: "watson", when: at(2, "10:00"), minutes: 300, svc: "deep", price: money(320), crew: [P("Ahmed"), P("Sofia")], divide: true },
    { client: "linda", when: at(5, "09:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Jake")], status: "pending" },
    { client: "ferguson", when: at(6, "13:00"), minutes: 180, svc: "standard", price: money(150), crew: [] },
    { client: "kyrstie", when: at(8, "10:00"), minutes: 180, svc: "standard", price: money(150), crew: [P("Priya")] },
    { client: "tetiana", when: at(12, "09:30"), minutes: 180, svc: "standard", price: money(160), crew: [P("Daniel")] },
    { client: "chance", when: at(3, "16:00"), minutes: 60, svc: "meeting", price: 0, crew: [maria], is_free: true, notes: "Go over the estimate in person." },
  ];
  const aheadIds: string[] = [];
  for (const a of ahead) aheadIds.push(await addBooking(a));
  const fergusonTomorrow = aheadIds[1];

  // ------------------------------------------------------------ invoices ----
  step("Invoices, payments, a prepayment, a void");
  const done = bookings.filter((b) => b.status === "completed" && !b.is_free && b.price > 0);
  const onDemandClients = new Set(clientSeeds.filter((c) => (c.cadence ?? "on_demand") === "on_demand").map((c) => c.key));
  let invoiceCount = 0;
  const perJob = done.filter((b) => onDemandClients.has(b.client) && !b.series_id).sort((a, b) => a.when.getTime() - b.when.getTime());
  const harrisonVisits = done.filter((b) => b.client === "harrison").sort((a, b) => a.when.getTime() - b.when.getTime());
  const billable = [...perJob, ...harrisonVisits].sort((a, b) => a.when.getTime() - b.when.getTime());
  const voidTarget = billable.find((b) => b.client === "kyrstie" && b.when < at(-15, "00:00"));
  for (const b of billable) {
    const age = (NOW.getTime() - b.when.getTime()) / 86_400_000;
    const isVoid = b.id === voidTarget?.id;
    const status = isVoid ? "void" : age > 35 ? "paid" : age > 24 ? "overdue" : age > 5 ? "sent" : "draft";
    const issued = new Date(b.when.getTime() + 86_400_000);
    const due = new Date(issued.getTime() + 14 * 86_400_000);
    const tax = Math.round(b.price * 0.05);
    const [inv] = await insert("invoices", {
      organization_id: org.id, client_id: C[b.client].id, booking_id: b.id,
      amount_cents: b.price + tax, tax_rate_bps: 500, tax_amount_cents: tax, tax_label: "GST",
      status, due_date: ymd(due), created_at: iso(issued),
      sent_at: status === "draft" ? null : iso(new Date(issued.getTime() + minutes(90))),
      paid_at: status === "paid" ? iso(new Date(issued.getTime() + 6 * 86_400_000)) : null,
      voided_at: isVoid ? iso(new Date(issued.getTime() + 3 * 86_400_000)) : null,
      notes: isVoid ? "Voided: client disputed the fridge extra; rebook agreed." : null,
    });
    invoiceCount++;
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
        received_at: iso(new Date(issued.getTime() + 6 * 86_400_000)), recorded_by: owner,
      });
    }
  }
  // Margaret is billed monthly: last month's visits on one invoice, sent.
  {
    const monthStart = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
    const monthEnd = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
    const visits = done.filter((b) => b.client === "margaret" && b.when >= monthStart && b.when < monthEnd);
    if (visits.length > 0) {
      const sub = visits.reduce((s, v) => s + v.price, 0);
      const tax = Math.round(sub * 0.05);
      const [inv] = await insert("invoices", {
        organization_id: org.id, client_id: C.margaret.id, amount_cents: sub + tax, tax_rate_bps: 500, tax_amount_cents: tax, tax_label: "GST",
        status: "sent", due_date: ymd(new Date(monthEnd.getTime() + 20 * 86_400_000)), created_at: iso(new Date(monthEnd.getTime() + 7 * 3_600_000)),
        sent_at: iso(new Date(monthEnd.getTime() + 9 * 3_600_000)), billing_period_key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
      });
      await insert("invoice_line_items", visits.map((v, i) => ({
        organization_id: org.id, invoice_id: inv.id, booking_id: v.id,
        label: `Standard clean — ${v.when.toLocaleDateString("en-CA", { timeZone: Z, month: "short", day: "numeric" })}`,
        quantity: 1, unit_price_cents: v.price, sort_order: i,
      })));
      for (const v of visits) await update("bookings", v.id, { billing_invoice_id: inv.id });
      invoiceCount++;
    }
  }
  // Money paid before the job.
  await insert("booking_prepayments", {
    organization_id: org.id, booking_id: fergusonTomorrow, client_id: C.ferguson.id, amount_cents: money(150),
    method: "cash", reference: null, notes: "Paid at the door last visit, for tomorrow.", received_at: iso(at(-2, "15:00")), recorded_by: owner,
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
  step("Estimates, portal request, tasks, reviews");
  const [estSent] = await insert("estimates", { organization_id: org.id, client_id: C.chance.id, service_description: "Deep clean before listing — 4 bed, 3 bath, finished basement.", status: "sent", total_cents: money(480), sent_at: iso(at(-8, "16:00")), expires_at: ymd(at(22, "00:00")), created_at: iso(at(-9, "12:00")) });
  await insert("estimate_line_items", [
    { organization_id: org.id, estimate_id: estSent.id, label: "Deep clean labour", quantity: 7, unit_price_cents: money(60), kind: "labour", sort_order: 0 },
    { organization_id: org.id, estimate_id: estSent.id, label: "Supplies", quantity: 1, unit_price_cents: money(60), kind: "supplies", sort_order: 1 },
  ]);
  const [estDraft] = await insert("estimates", { organization_id: org.id, client_id: C.watson.id, service_description: "Monthly standard clean, 3 hours.", status: "draft", total_cents: money(150), created_at: iso(at(-1, "10:00")) });
  await insert("estimate_line_items", { organization_id: org.id, estimate_id: estDraft.id, label: "Standard clean", quantity: 3, unit_price_cents: money(50), kind: "labour", sort_order: 0 });
  const [estApproved] = await insert("estimates", { organization_id: org.id, client_id: C.gabriel.id, service_description: "Move-out clean, 10 hours with three cleaners.", status: "approved", total_cents: money(725), sent_at: iso(at(-6, "11:00")), decided_at: iso(at(-5, "09:00")), created_at: iso(at(-6, "10:00")) });
  await insert("estimate_line_items", { organization_id: org.id, estimate_id: estApproved.id, label: "Move-out clean", quantity: 10, unit_price_cents: money(72.5), kind: "labour", sort_order: 0 });
  await update("bookings", aheadIds[0], { estimate_id: estApproved.id });

  await insert("booking_requests", { organization_id: org.id, client_id: C.watson.id, service_type: "Deep clean", preferred_date: ymd(at(7, "00:00")), preferred_time_window: "morning", address: C.watson.address, notes: "Please avoid scented products.", status: "pending" });

  await insert("tasks", [
    { organization_id: org.id, created_by: owner, assigned_to: maria, title: "Order microfibre cloths and two mop heads", due_at: iso(at(-1, "17:00")), notes: "Stock is below threshold." },
    { organization_id: org.id, created_by: owner, assigned_to: maria, title: "Call Margaret about the spare key", due_at: iso(at(0, "16:00")) },
    { organization_id: org.id, created_by: maria, assigned_to: owner, title: "Renew liability insurance", due_at: iso(at(-12, "12:00")), completed_at: iso(at(-13, "15:00")) },
    { organization_id: org.id, created_by: owner, assigned_to: maria, title: "Weekly supply check", due_at: iso(at(3, "09:00")), recurrence: "weekly" },
  ]);

  const reviewable = done.filter((b) => b.crew.length > 0).slice(-8);
  await insert("reviews", reviewable.map((b, i) => ({
    organization_id: org.id, booking_id: b.id, client_id: C[b.client].id, employee_id: b.crew[0],
    rating: [5, 5, 4, 5, 4, 5, 3, 5][i % 8],
    comment: ["Spotless, thank you!", "Great job on the oven.", "Arrived a bit late but the work was excellent.", "Always reliable.", "Bathrooms perfect, kitchen floor could use another pass.", "Love coming home on cleaning day.", "Missed the baseboards this time.", "Fantastic as usual."][i % 8],
    submitted_at: iso(new Date(b.when.getTime() + 26 * 3_600_000)),
  })));

  // ------------------------------------------- training, inventory, PTO ---
  step("Training, inventory, PTO, availability, chat, feedback");
  const [mod] = await insert("training_modules", { organization_id: org.id, title: "Chemical safety", description: "Before your first shift.", created_by: owner, status: "published", assign_on_join: true });
  const steps = await insert("training_steps", [
    { organization_id: org.id, module_id: mod.id, ord: 0, body: "Read the product label before use. Never mix chemicals, especially bleach with anything acidic." },
    { organization_id: org.id, module_id: mod.id, ord: 1, body: "Gloves and eye protection for oven cleaner and descalers." },
    { organization_id: org.id, module_id: mod.id, ord: 2, body: "Ventilate: open a window or run the fan whenever you spray." },
  ]);
  const cleaners = ["Olena", "Daniel", "Priya", "Jake", "Sofia", "Ahmed"];
  await insert("training_assignments", cleaners.map((f, i) => ({
    organization_id: org.id, module_id: mod.id, employee_id: P(f),
    completed_step_ids: i < 4 ? steps.map((s) => s.id) : i === 4 ? [steps[0].id] : [],
    completed_at: i < 4 ? iso(at(-30 + i, "18:00")) : null,
  })));

  await insert("inventory_items", [
    { organization_id: org.id, name: "All-purpose cleaner (4 L)", category: "chemical", quantity: 6, reorder_threshold: 3 },
    { organization_id: org.id, name: "Glass cleaner (1 L)", category: "chemical", quantity: 2, reorder_threshold: 4 },
    { organization_id: org.id, name: "Oven cleaner", category: "chemical", quantity: 3, reorder_threshold: 2 },
    { organization_id: org.id, name: "Microfibre cloths", category: "consumable", quantity: 18, reorder_threshold: 30 },
    { organization_id: org.id, name: "Mop heads", category: "consumable", quantity: 4, reorder_threshold: 4 },
    { organization_id: org.id, name: "Nitrile gloves (box)", category: "consumable", quantity: 7, reorder_threshold: 3 },
    { organization_id: org.id, name: "Vacuum — Miele C3", category: "equipment", quantity: 3, reorder_threshold: 0, assigned_to: P("Olena") },
    { organization_id: org.id, name: "Steam mop", category: "equipment", quantity: 2, reorder_threshold: 0 },
  ]);

  await insert("pto_requests", { organization_id: org.id, employee_id: P("Jake"), start_date: ymd(at(10, "00:00")), end_date: ymd(at(11, "00:00")), hours: 16, reason: "Family wedding", status: "pending" });

  const avail: Array<Record<string, unknown>> = [];
  for (const f of ["Olena", "Daniel", "Priya", "Jake", "Ahmed"]) {
    for (const dow of [1, 2, 3, 4, 5]) avail.push({ organization_id: org.id, membership_id: P(f), day_of_week: dow, start_time: f === "Ahmed" ? "06:30" : "08:00", end_time: f === "Priya" ? "21:00" : "17:00" });
  }
  await insert("availability_slots", avail);

  const [general] = await insert("chat_threads", { organization_id: org.id, kind: "group", name: "general" });
  const everyone = [owner, ...Object.values(people).map((p) => p.id)];
  await insert("chat_thread_members", everyone.map((m) => ({ organization_id: org.id, thread_id: general.id, membership_id: m })));
  await insert("chat_messages", [
    { organization_id: org.id, thread_id: general.id, sender_id: owner, body: "Welcome to the team chat. Job questions here, anything private to Maria or me directly.", created_at: iso(at(-40, "08:00")) },
    { organization_id: org.id, thread_id: general.id, sender_id: maria, body: "Reminder: Riverbend's alarm code changed. It's in the property notes.", created_at: iso(at(-6, "17:30")) },
    { organization_id: org.id, thread_id: general.id, sender_id: P("Olena"), body: "Margaret left a thank-you card and cookies 🍪", created_at: iso(at(-2, "16:10")) },
    { organization_id: org.id, thread_id: general.id, sender_id: P("Daniel"), body: "Heads up — Harrisons' garage door sticks, pull up on the handle.", created_at: iso(at(-1, "11:45")) },
    { organization_id: org.id, thread_id: general.id, sender_id: maria, body: `Gabriel's move-out is tomorrow 9:00, three of you. Oven and fridge are in.`, created_at: iso(at(0, "07:50")) },
  ]);

  await insert("feedback_items", [
    { organization_id: org.id, kind: "idea", title: "Let me reorder the checklist from my phone", body: "The kitchen section should come before bathrooms for most houses.", status: "open", created_by: P("Olena"), page_context: "/field/jobs" },
    { organization_id: org.id, kind: "bug", title: "Invoice PDF cut off the GST line on my phone", body: "Only on the small screen. Fine on the laptop.", status: "shipped", created_by: maria, page_context: "/app/invoices" },
  ]);

  // -------------------------------------------------------------- report ----
  console.log(`
Done. "${org.name}" now has:
  people      owner + ${cast.length} (manager Maria; Sofia has hours but no pay rate)
  clients     ${clientSeeds.length} (1 lead: Chance; monthly: Margaret, Riverbend; biweekly: Whyte Ave Yoga)
  series      ${seriesSeeds.length}; one Harrisons visit drifted an hour → Needs-you Restore/Keep
  bookings    ${bookings.length} (${bookings.filter((b) => b.status === "completed").length} done, ${bookings.filter((b) => b.when > NOW).length} ahead)
  today       Linda's job started 3h ago with no clock-in; Tetiana's deep clean in progress (Olena on the clock); Kyrstie's finished job has no price
  flags       Daniel's last Harrisons shift auto-closed and flagged${flaggedVisit ? "" : " (none)"}; Jake's PTO pending; an unstaffed Ferguson job next week; a pending Linda job
  invoices    ${invoiceCount} (paid, sent, overdue, draft, one void with its job released; Margaret's month on one invoice)
  money       $150 prepaid by the Fergusons for tomorrow
  estimates   sent (Chance), draft (Dr. Watson), approved (Gabriel → tomorrow's move-out)
  requests    1 portal request from Dr. Watson

Sign in as any demo person: <first name>@${DEMO_DOMAIN} / ${DEMO_PASSWORD}
  (maria, olena, daniel, priya, jake, sofia, ahmed)
`);
  void noClockInId;
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
