import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Do the three records of "this job is billed" agree?
 *
 *   A. invoices.booking_id            a single-job invoice names its job
 *   B. invoice_line_items.booking_id  a line names its job
 *   C. bookings.billing_invoice_id    the job's own stamp
 *
 * Every "is this billed?" question goes through resolveBilledBookings
 * (billed-bookings.ts), which reads all three, so a job with one of them
 * missing is still seen as billed. This is the check that they have not
 * drifted, run every morning (morning-check.ts, section 9), because drift
 * has no symptom until it costs money:
 *
 *   - Two live invoices claiming one job is a client about to be charged
 *     twice. Found on 2026-11-15: a June visit paid on one invoice and
 *     still listed on a draft made in July.
 *   - A live invoice naming a job that carries no stamp is harmless today,
 *     and is exactly the state in which the next piece of code that reads
 *     only the stamp bills it again. 14 of Svit's jobs were like this on
 *     2026-11-15, all from April to July.
 *
 * A stamp with no link is not a disagreement: older invoices list their
 * jobs as typed text, and for those the stamp is the only record.
 */

export type AgreementInvoice = { id: string; number: string | null; status: string; booking_id: string | null };
export type AgreementLine = { invoice_id: string; booking_id: string | null };
export type AgreementJob = { id: string; billing_invoice_id: string | null };

export type BilledDisagreement =
  | { kind: "two_invoices"; jobId: string; invoices: string[] }
  | { kind: "no_stamp"; jobId: string; invoices: string[] };

export type BilledAgreement = {
  /** Jobs billed by at least one live invoice, by any record. */
  billedJobs: number;
  found: BilledDisagreement[];
};

/** Pure: the comparison, with no database. Void invoices never count. */
export function billedDisagreements(
  invoices: readonly AgreementInvoice[],
  lines: readonly AgreementLine[],
  stampedJobs: readonly AgreementJob[],
): BilledAgreement {
  const live = new Map<string, AgreementInvoice>();
  for (const i of invoices) if (i.status !== "void") live.set(i.id, i);
  const label = (id: string) => live.get(id)?.number ?? id.slice(0, 8);

  const linked = new Map<string, Set<string>>();
  const note = (jobId: string | null, invoiceId: string) => {
    if (!jobId || !live.has(invoiceId)) return;
    const set = linked.get(jobId) ?? new Set<string>();
    set.add(invoiceId);
    linked.set(jobId, set);
  };
  for (const i of invoices) note(i.booking_id, i.id);
  for (const l of lines) note(l.booking_id, l.invoice_id);

  const stamp = new Map<string, string>();
  for (const j of stampedJobs) {
    if (j.billing_invoice_id && live.has(j.billing_invoice_id)) stamp.set(j.id, j.billing_invoice_id);
  }

  const found: BilledDisagreement[] = [];
  const jobs = new Set<string>([...linked.keys(), ...stamp.keys()]);
  for (const jobId of jobs) {
    const claims = new Set<string>(linked.get(jobId) ?? []);
    const stamped = stamp.get(jobId);
    if (stamped) claims.add(stamped);
    if (claims.size > 1) {
      found.push({ kind: "two_invoices", jobId, invoices: [...claims].map(label).sort() });
    } else if (!stamped) {
      found.push({ kind: "no_stamp", jobId, invoices: [...claims].map(label) });
    }
  }
  // The dangerous ones first.
  found.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "two_invoices" ? -1 : 1));
  return { billedJobs: jobs.size, found };
}

/** Every row a query matches, a page at a time (the API caps a read at 1,000 rows). */
async function paged<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < 1000) break;
  }
  return rows;
}

/** Read one company's three records and compare them. Throws when a read fails. */
export async function loadBilledAgreement(db: SupabaseClient, organizationId: string): Promise<BilledAgreement> {
  const [invoices, lines, stamped] = await Promise.all([
    paged<AgreementInvoice>("invoices", (from, to) =>
      db
        .from("invoices")
        .select("id, number, status, booking_id")
        .eq("organization_id", organizationId)
        .neq("status", "void")
        .order("id")
        .range(from, to),
    ),
    paged<AgreementLine>("invoice lines", (from, to) =>
      db
        .from("invoice_line_items")
        .select("invoice_id, booking_id")
        .eq("organization_id", organizationId)
        .not("booking_id", "is", null)
        .order("id")
        .range(from, to),
    ),
    paged<AgreementJob>("stamped jobs", (from, to) =>
      db
        .from("bookings")
        .select("id, billing_invoice_id")
        .eq("organization_id", organizationId)
        .not("billing_invoice_id", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  return billedDisagreements(invoices, lines, stamped);
}

/** The report's lines: one per kind, with the invoices to open. */
export function billedAgreementLines(a: BilledAgreement, max = 6): string[] {
  const twice = a.found.filter((f) => f.kind === "two_invoices");
  const noStamp = a.found.filter((f) => f.kind === "no_stamp");
  const out: string[] = [];
  const list = (rows: BilledDisagreement[]) => {
    const shown = rows.slice(0, max).map((r) => r.invoices.join(" + "));
    return shown.join("; ") + (rows.length > max ? `; and ${rows.length - max} more` : "");
  };
  out.push(
    `   ${String(twice.length).padStart(3)}  job(s) claimed by two live invoices${twice.length ? ` (a client could be charged twice): ${list(twice)}` : ""}`,
  );
  out.push(
    `   ${String(noStamp.length).padStart(3)}  job(s) on a live invoice with no stamp on the job${noStamp.length ? `: ${list(noStamp)}` : ""}`,
  );
  return out;
}
