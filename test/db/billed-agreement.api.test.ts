/**
 * "Is this job billed?" has one answer, and the morning email says when the
 * records behind it drift (2026-11-15).
 *
 * resolveBilledBookings reads three records. Two places counted "unbilled"
 * jobs from the stamp alone: the Series page and the notice sent with a
 * standing invoice. A job an invoice named without a stamp (14 of Svit's,
 * all billed April to July) was unbilled to them and billed to everything
 * else. They ask the shared question now (withoutAnInvoice), and the last
 * test here fails if a new read of the stamp alone appears.
 *
 * Against the real database behind the real PostgREST (test/db/api.ts).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

type Company = { org: string; client: string };

async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Billed Co");
  await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
  await addMember(api.sql, org, "owner", "Owner");
  return { org, client: await addClient(api.sql, org) };
}

const doneJob = (c: Company, daysAgo: number) =>
  addBooking(api.sql, c.org, c.client, {
    scheduledAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    durationMinutes: 120,
    status: "completed",
  });

/** An invoice. `own` names a job in the invoice's own column; `lines` name jobs on lines. */
async function invoice(
  c: Company,
  status: string,
  opts: { own?: string; lines?: string[]; stamp?: string[] } = {},
): Promise<{ id: string; number: string }> {
  const [inv] = await api.sql<{ id: string; number: string }>(
    `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
     values ($1, $2, $3, $4::public.invoice_status, 14000) returning id, number`,
    [c.org, c.client, opts.own ?? null, status],
  );
  for (const job of opts.lines ?? []) {
    await api.sql(
      `insert into public.invoice_line_items (organization_id, invoice_id, label, quantity, unit_price_cents, booking_id)
       values ($1, $2, 'Standard clean', 1, 14000, $3)`,
      [c.org, inv.id, job],
    );
  }
  for (const job of opts.stamp ?? []) {
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [job, inv.id]);
  }
  return inv;
}

describe.skipIf(!hasPostgrest)("one answer to: is this job billed?", () => {
  it("withoutAnInvoice: a job a live invoice names is billed, stamp or no stamp; a void invoice bills nothing", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { withoutAnInvoice } = await import("@/lib/billed-bookings");
    const c = await company();
    const free = await doneJob(c, 2);
    const linkedNoStamp = await doneJob(c, 3);
    const ownColumnNoStamp = await doneJob(c, 4);
    const stampedOnly = await doneJob(c, 5);
    const onVoid = await doneJob(c, 6);
    await invoice(c, "sent", { lines: [linkedNoStamp] });
    await invoice(c, "paid", { own: ownColumnNoStamp });
    await invoice(c, "sent", { stamp: [stampedOnly] });
    await invoice(c, "void", { lines: [onVoid] });

    const rows = [free, linkedNoStamp, ownColumnNoStamp, stampedOnly, onVoid].map((id) => ({ id }));
    const unbilled = await withoutAnInvoice(createSupabaseAdminClient(), rows);
    expect(unbilled.map((r) => r.id).sort()).toEqual([free, onVoid].sort());
  });

  it("the morning check counts the records that disagree, and raises the double claim first", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { runMorningCheck } = await import("@/lib/morning-check");
    const c = await company();
    const fine = await doneJob(c, 2);
    const noStamp = await doneJob(c, 3);
    const twice = await doneJob(c, 4);
    await invoice(c, "sent", { lines: [fine], stamp: [fine] });
    await invoice(c, "paid", { own: noStamp });
    const paid = await invoice(c, "paid", { own: twice });
    const draft = await invoice(c, "draft", { stamp: [twice] });

    const report = await runMorningCheck(createSupabaseAdminClient(), { orgId: c.org, hoursBack: 24 });
    const text = report.lines.join("\n");
    expect(text).toContain("9. BILLED RECORDS (3 billed jobs compared): 2 disagree");
    expect(text).toMatch(new RegExp(`1 {2}job\\(s\\) claimed by two live invoices.*${[paid.number, draft.number].sort().join(" \\+ ")}`));
    expect(text).toMatch(/1 {2}job\(s\) on a live invoice with no stamp on the job/);
    const twiceFlag = report.flags.findIndex((f) => /1 job\(s\) are claimed by two live invoices/.test(f));
    const stampFlag = report.flags.findIndex((f) => /1 billed job\(s\) carry no stamp/.test(f));
    expect(twiceFlag).toBeGreaterThanOrEqual(0);
    expect(stampFlag).toBeGreaterThan(twiceFlag);
  });

  it("a company whose records agree raises neither flag, and another company's invoices are not counted", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const { runMorningCheck } = await import("@/lib/morning-check");
    const clean = await company();
    const messy = await company();
    const job = await doneJob(clean, 2);
    await invoice(clean, "sent", { lines: [job], stamp: [job] });
    await invoice(messy, "paid", { own: await doneJob(messy, 2) });

    const report = await runMorningCheck(createSupabaseAdminClient(), { orgId: clean.org, hoursBack: 24 });
    expect(report.lines.join("\n")).toContain("9. BILLED RECORDS (1 billed jobs compared): 0 disagree");
    expect(report.flags.join("\n")).not.toMatch(/two live invoices|carry no stamp/);
  });
});

// ---------------------------------------------------------------------------
// The guard. No database needed: it reads the source.

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** A filter on the stamp being empty: `.is("billing_invoice_id", null)`. */
const STAMP_IS_NULL = /\.is\(\s*["']billing_invoice_id["'](?:\s+as\s+never)?\s*,\s*null/g;
/** The shared question, in any of its forms. */
const SHARED_CHECK = /\b(withoutAnInvoice|resolveBilledBookings|resolveBilledBookingsChunked|billableInSweep)\s*\(/;

/**
 * The reads in this source that pick jobs by an empty stamp. A write that
 * only claims an unstamped job (`.update(...).is("billing_invoice_id", null)`)
 * is a guard, not a question, and is left out.
 */
export function stampOnlyReads(source: string): number {
  let reads = 0;
  for (const m of source.matchAll(STAMP_IS_NULL)) {
    const statement = source.slice(source.lastIndexOf(".from(", m.index), m.index);
    if (/\.(update|delete|upsert)\(/.test(statement)) continue;
    reads++;
  }
  return reads;
}

describe("nothing decides 'unbilled' from the stamp alone", () => {
  it("every file that reads jobs by an empty stamp also asks the shared question", () => {
    const root = join(__dirname, "..", "..", "src");
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      if (rel === "lib/billed-bookings.ts") continue;
      const source = readFileSync(file, "utf8");
      if (stampOnlyReads(source) > 0 && !SHARED_CHECK.test(source)) offenders.push(rel);
    }
    expect(offenders, "count unbilled jobs with withoutAnInvoice() from src/lib/billed-bookings.ts").toEqual([]);
  });

  it("the guard tells a read from a write that claims an unstamped job", () => {
    // As the Series page read it before 2026-11-15.
    expect(
      stampOnlyReads(
        'await supabase\n  .from("bookings")\n  .select("series_id")\n  .eq("status", "completed")\n  .is("billing_invoice_id" as never, null as never)',
      ),
    ).toBe(1);
    // A claim: stamp it only if nothing else has.
    expect(
      stampOnlyReads(
        'await admin\n  .from("bookings")\n  .update({ billing_invoice_id: inv.id } as never)\n  .in("id", ids)\n  .is("billing_invoice_id", null)',
      ),
    ).toBe(0);
    // The other way round is not this guard's business.
    expect(stampOnlyReads('.from("bookings").select("id").not("billing_invoice_id", "is", null)')).toBe(0);
  });
});
