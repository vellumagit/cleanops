/**
 * Mark jobs a person already voided off an invoice, so the billing run leaves
 * them alone (bookings.billing_released_at, migration 20261030040000).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-billing-released.ts [orgId] [--apply]
 *
 * Prints the list without --apply. Defaults to Svit.
 *
 * A job qualifies when it is completed and unstamped, is on no live invoice,
 * and a voided invoice names it. Invoices made before line links existed name
 * their jobs only in text, so those are matched by date and price against the
 * voided invoice's lines (matchLineToJob's rule, one clear match or nothing).
 * Void time isn't known per job from older rows, so the invoice's voided_at is
 * used. A job on two voided invoices gets the later one.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgId = args.find((a) => !a.startsWith("--")) ?? "4cf4c402-5889-43c9-91f3-7186f66ee08b";
// UTC-6 forever: never read Edmonton through a Node with old tzdata.
const ZONE = "America/Regina";
const CHUNK = 300;

const day = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));

/** "Standard — Apr 2 @ 903 Proctor" is how the oldest lines name a day. */
const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date(iso));

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

type Job = {
  id: string;
  client_id: string | null;
  scheduled_at: string;
  total_cents: number | null;
  client: { name: string | null } | null;
};

async function main() {
  const { data: jobsRaw, error: jobsErr } = await db
    .from("bookings")
    .select("id, client_id, scheduled_at, total_cents, client:clients(name)")
    .eq("organization_id", orgId)
    .eq("status", "completed")
    .is("billing_invoice_id", null);
  if (jobsErr) throw new Error(jobsErr.message);
  const jobs = (jobsRaw ?? []) as unknown as Job[];

  const { data: voidedRaw, error: voidErr } = await db
    .from("invoices")
    .select("id, number, client_id, booking_id, voided_at")
    .eq("organization_id", orgId)
    .not("voided_at", "is", null);
  if (voidErr) throw new Error(voidErr.message);
  const voided = (voidedRaw ?? []) as Array<{
    id: string;
    number: string | null;
    client_id: string | null;
    booking_id: string | null;
    voided_at: string;
  }>;

  const voidedLines: Array<{
    invoice_id: string;
    booking_id: string | null;
    label: string;
    quantity: number;
    unit_price_cents: number;
  }> = [];
  for (const ids of chunks(voided.map((v) => v.id))) {
    const { data, error } = await db
      .from("invoice_line_items")
      .select("invoice_id, booking_id, label, quantity, unit_price_cents")
      .in("invoice_id", ids);
    if (error) throw new Error(error.message);
    voidedLines.push(...((data ?? []) as typeof voidedLines));
  }

  // Anything on a live invoice stays out, by whichever signal says so.
  const live = new Set<string>();
  for (const ids of chunks(jobs.map((j) => j.id))) {
    const [{ data: perJob, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
      db.from("invoices").select("booking_id").is("voided_at", null).in("booking_id", ids),
      db.from("invoice_line_items").select("booking_id, invoice:invoices!inner(voided_at)").is("invoices.voided_at", null).in("booking_id", ids),
    ]);
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    for (const r of perJob ?? []) if (r.booking_id) live.add(r.booking_id);
    for (const r of lines ?? []) if (r.booking_id) live.add(r.booking_id);
  }
  const open = jobs.filter((j) => !live.has(j.id));
  const byId = new Map(open.map((j) => [j.id, j]));
  const voidById = new Map(voided.map((v) => [v.id, v]));

  const hits = new Map<string, { at: string; number: string | null; how: string }>();
  const note = (jobId: string, inv: (typeof voided)[number], how: string) => {
    if (!byId.has(jobId)) return;
    const prev = hits.get(jobId);
    if (!prev || prev.at < inv.voided_at) hits.set(jobId, { at: inv.voided_at, number: inv.number, how });
  };
  for (const v of voided) if (v.booking_id) note(v.booking_id, v, "per-job");
  for (const l of voidedLines) {
    const inv = voidById.get(l.invoice_id);
    if (!inv) continue;
    if (l.booking_id) {
      note(l.booking_id, inv, "line link");
      continue;
    }
    if (l.quantity !== 1) continue;
    const fits = open.filter(
      (j) =>
        j.client_id === inv.client_id &&
        j.total_cents === l.unit_price_cents &&
        (l.label.includes(day(j.scheduled_at)) ||
          new RegExp(`\\b${shortDay(j.scheduled_at)}\\b`).test(l.label)),
    );
    if (fits.length === 1) note(fits[0].id, inv, "date and price");
  }

  const rows = [...hits.entries()]
    .map(([id, h]) => ({ id, ...h, job: byId.get(id)! }))
    .sort(
      (a, b) =>
        (a.job.client?.name ?? "").localeCompare(b.job.client?.name ?? "") ||
        a.job.scheduled_at.localeCompare(b.job.scheduled_at),
    );
  let client = "";
  for (const r of rows) {
    const name = r.job.client?.name ?? "(no client)";
    if (name !== client) console.log(`\n${name}`);
    client = name;
    console.log(
      `  ${day(r.job.scheduled_at).padEnd(18)} $${String((r.job.total_cents ?? 0) / 100).padEnd(8)} voided on ${r.number ?? "?"} (${r.how})`,
    );
  }
  const total = rows.reduce((n, r) => n + (r.job.total_cents ?? 0), 0) / 100;
  console.log(`\n${rows.length} jobs, $${total}. ${apply ? "Applying." : "Nothing written; add --apply."}`);
  if (!apply) return;

  let written = 0;
  for (const r of rows) {
    const { data, error } = await db
      .from("bookings")
      .update({ billing_released_at: r.at })
      .eq("id", r.id)
      .eq("organization_id", orgId)
      .is("billing_invoice_id", null)
      .is("billing_released_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    written += data?.length ?? 0;
  }
  const { error: auditErr } = await db.from("audit_log").insert({
    organization_id: orgId,
    actor_id: null,
    action: "update",
    entity: "settings",
    entity_id: orgId,
    after: { billing_released_backfill: written, script: "backfill-billing-released" },
  });
  console.log(`Marked ${written} of ${rows.length}.${auditErr ? ` Audit failed: ${auditErr.message}` : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
