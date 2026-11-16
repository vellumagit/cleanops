/**
 * "Generate invoices for all completed jobs" (bulkGenerateInvoicesAction)
 * at Svit's size, against a real database behind the real PostgREST.
 *
 * It sent every completed job's id in one request to see which were
 * already billed. Svit had 400 completed jobs on 2026-11-16, about where
 * production refuses the address; the stack refuses it the same way
 * (MAX_URL_BYTES). What it owes the books: each unbilled job gets one
 * invoice, and a billed job never gets a second.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg } from "./harness";
import { request, settle } from "./next-stubs";

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

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

// 420 jobs take longer than the default 20 seconds when the whole suite runs at once.
describe.skipIf(!hasPostgrest)("generate invoices for all completed jobs, at Svit's size", { timeout: 120_000 }, () => {
  it("420 finished jobs, 415 already billed: the 5 get one invoice each, nothing billed twice", async () => {
    const { bulkGenerateInvoicesAction } = await import("@/app/app/invoices/actions");
    const org = await addOrg(api.sql, "Bulk Co");
    await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const client = await addClient(api.sql, org);
    await api.sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents)
       select $1, $2, date_trunc('day', now()) - make_interval(days => g, hours => -9), 120, 'standard', 'completed', 14000
         from generate_series(1, 420) g`,
      [org, client],
    );
    // All but the five most recent are already billed, one invoice each.
    await api.sql(
      `with billed as (
         select id from public.bookings where organization_id = $1 order by scheduled_at asc limit 415)
       insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents)
       select $1, $2, id, 'sent', 14000 from billed`,
      [org, client],
    );
    await api.sql(
      "update public.bookings b set billing_invoice_id = i.id from public.invoices i where i.booking_id = b.id and i.organization_id = $1",
      [org],
    );

    request.cookies = api.sessionCookies(owner.userId);
    let result: Awaited<ReturnType<typeof bulkGenerateInvoicesAction>>;
    try {
      result = await bulkGenerateInvoicesAction();
    } finally {
      await settle();
    }
    expect(result, JSON.stringify(result)).toMatchObject({ created: 5, skipped: 415 });
    const [{ jobs, doubled }] = await api.sql<{ jobs: number; doubled: number }>(
      `select count(distinct booking_id)::int as jobs,
              (select count(*)::int from (select booking_id from public.invoices where organization_id = $1 and status <> 'void'
                                           group by booking_id having count(*) > 1) d) as doubled
         from public.invoices where organization_id = $1 and status <> 'void'`,
      [org],
    );
    expect({ jobs, doubled }).toEqual({ jobs: 420, doubled: 0 });
  });
});
