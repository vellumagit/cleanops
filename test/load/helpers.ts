/**
 * Setting the scene for the load tests: companies, people, jobs, and a
 * person's action run as their own request. Every helper takes the stack
 * (test/db/api.ts, on a real server) so each file keeps its own.
 */
import type { Api } from "../db/api";
import { addBooking, addClient, addMember, addOrg, type Member } from "../db/harness";
import { inRequest } from "../db/next-stubs";

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const daysAgoYmd = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A company in UTC, with the automations these tests lean on. */
export async function company(api: Api, label: string, opts: { autoInvoice?: boolean } = {}) {
  const org = await addOrg(api.sql, label);
  await api.sql(
    "update public.organizations set automations_enabled = true, timezone = 'UTC', automation_settings = $2::jsonb where id = $1",
    [
      org,
      JSON.stringify({
        divide_crew_hours: { enabled: true },
        ...(opts.autoInvoice ? { auto_invoice_on_job_complete: { enabled: true } } : {}),
      }),
    ],
  );
  const owner = await addMember(api.sql, org, "owner", `${label} Owner`);
  return { org, owner, client: await addClient(api.sql, org) };
}

export async function people(
  api: Api,
  org: string,
  n: number,
  label: string,
  role: "employee" | "manager" | "admin" = "employee",
): Promise<Member[]> {
  const out: Member[] = [];
  for (let i = 0; i < n; i++) out.push(await addMember(api.sql, org, role, `${label} ${i + 1}`));
  return out;
}

/** A job with this crew (first is the lead), all accepted. */
export async function job(
  api: Api,
  org: string,
  client: string,
  crew: Member[],
  opts: { at?: string; startedMinutesAgo?: number; minutes?: number; status?: string; totalCents?: number } = {},
): Promise<string> {
  const id = await addBooking(api.sql, org, client, {
    scheduledAt: opts.at ?? minutesAgo(opts.startedMinutesAgo ?? 10),
    durationMinutes: opts.minutes ?? 240,
    status: opts.status ?? "confirmed",
  });
  await api.sql("update public.bookings set total_cents = $2, divide_hours_evenly = $3 where id = $1", [
    id,
    opts.totalCents ?? 20000,
    crew.length > 1,
  ]);
  for (const [i, m] of crew.entries()) {
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       values ($1, $2, $3, $4, 'accepted')`,
      [org, id, m.membershipId, i === 0],
    );
  }
  if (crew[0]) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, crew[0].membershipId]);
  return id;
}

export function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
}

/**
 * Run `work` as this person's own request, timed. A redirect (which a
 * server action throws) counts as an answer, not a failure.
 */
export async function as<T>(api: Api, who: Member, work: () => Promise<T>): Promise<{ result: T | string; ms: number }> {
  const t0 = performance.now();
  try {
    const result = await inRequest(api.sessionCookies(who.userId), work);
    return { result, ms: performance.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/^redirected to /.test(message)) return { result: message, ms: performance.now() - t0 };
    throw err;
  }
}

export const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

export function timing(label: string, ms: number[], wall: number): string {
  const s = [...ms].sort((a, b) => a - b);
  return `[load] ${label}: all done in ${Math.round(wall)} ms; each p50 ${Math.round(pct(s, 50))} ms, p95 ${Math.round(pct(s, 95))} ms, max ${Math.round(s[s.length - 1])} ms`;
}
