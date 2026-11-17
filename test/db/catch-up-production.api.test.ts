/**
 * The production catch-up (20261116070000), proved on a copy shaped like
 * production on 16 Nov 2026, through the real PostgREST with each person's
 * own sign-in, the way someone using the API directly would.
 *
 *   production today      three migrations never ran, and three hand-made
 *                         rules let any member update any booking, estimate
 *                         or invoice in their company (docs/fix-later.md)
 *   after the catch-up    the holes are closed, the office's and the crew's
 *                         everyday edits still land, and the drift check
 *                         finds nothing left (webhooks aside)
 *
 * The production shape below is copied from what the read-only checks
 * returned (docs/production-drift-check.sql, docs/production-policy-check.sql).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, MIGRATIONS_DIR } from "./harness";

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

const MEMBER_ORG = `(select memberships.organization_id from memberships
   where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status limit 1)`;
const OWNER_ADMIN_OR_ASSIGNEE = `(current_user_has_role(organization_id, array['owner'::membership_role, 'admin'::membership_role])
   or assigned_to in (select memberships.id from memberships
     where memberships.profile_id = auth.uid() and memberships.status = 'active'::membership_status))`;

/** Turn the migrated database into production as the 16 Nov checks found it. */
const PRODUCTION_TODAY = `
drop policy if exists "managers or crew update bookings" on public.bookings;
drop trigger if exists time_entries_employee_insert_guard on public.time_entries;
drop trigger if exists memberships_owner_guard on public.memberships;
drop trigger if exists invitations_owner_guard on public.invitations;
drop trigger if exists bookings_assignee_column_guard on public.bookings;
drop trigger if exists bookings_client_org_guard on public.bookings;
drop trigger if exists invoices_client_org_guard on public.invoices;
drop trigger if exists estimates_client_org_guard on public.estimates;
drop trigger if exists contracts_client_org_guard on public.contracts;
drop function public.is_booking_crew(uuid);
drop function public.report_job_profitability(uuid, timestamptz, timestamptz);
drop function public.report_cleaner_scorecard(uuid, timestamptz, timestamptz);
drop function public.time_entries_employee_insert_guard();
drop function public.invitations_owner_guard();
drop function public.bookings_assignee_column_guard();
drop function public.client_org_guard();
drop function public.is_service_role();
drop policy "members read own org payroll_runs" on public.payroll_runs;
drop policy "members read own org payroll_items" on public.payroll_items;
drop policy subcontractor_bills_select on public.subcontractor_bills;
drop policy subcontractor_payouts_select on public.subcontractor_payouts;
create policy "admins or assignee update bookings" on public.bookings for update to authenticated
  using ${OWNER_ADMIN_OR_ASSIGNEE} with check ((archived_at is null) and ${OWNER_ADMIN_OR_ASSIGNEE});
create policy "Members can update their org bookings" on public.bookings for update to public
  using (organization_id = ${MEMBER_ORG}) with check ((organization_id = ${MEMBER_ORG}) and (archived_at is null));
create policy "Members can update their org estimates" on public.estimates for update to public
  using (organization_id = ${MEMBER_ORG}) with check ((organization_id = ${MEMBER_ORG}) and (archived_at is null));
create policy "Members can update their org invoices" on public.invoices for update to public
  using (organization_id = ${MEMBER_ORG}) with check ((organization_id = ${MEMBER_ORG}) and (archived_at is null));
create policy "employees can insert own pto requests" on public.pto_requests for insert to public
  with check (employee_id in (select m.id from memberships m where m.profile_id = auth.uid() and m.status = 'active'::membership_status));
`;

/** A request to PostgREST as this person, the way the API is reached directly. */
async function rest(userId: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${api.tokenFor(userId)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let rows: unknown[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed;
  } catch {
    // an empty or error body
  }
  return { status: res.status, rows, text };
}
const changed = async (userId: string, table: string, id: string, patch: Record<string, unknown>) =>
  rest(userId, "PATCH", `${table}?id=eq.${id}`, patch);
/** An edit with no filter and no returned rows: it needs no right to read. */
const blindEdit = async (userId: string, table: string, patch: Record<string, unknown>) =>
  fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: "PATCH",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      Authorization: `Bearer ${api.tokenFor(userId)}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });

async function company() {
  const org = await addOrg(api.sql, "Catch-up Co");
  const owner = await addMember(api.sql, org, "owner", "Svitlana");
  const olha = await addMember(api.sql, org, "manager", "Olha");
  const anna = await addMember(api.sql, org, "employee", "Anna");
  const ivan = await addMember(api.sql, org, "employee", "Ivan");
  const client = await addClient(api.sql, org, "Catch-up Client");
  // Due now, so starting it is legitimate (a job too far ahead can't be).
  const job = await addBooking(api.sql, org, client, { scheduledAt: new Date(Date.now() - 5 * 60_000).toISOString() });
  await api.sql("update public.bookings set assigned_to = $2, total_cents = 20000 where id = $1", [job, anna.membershipId]);
  await addCrew(api.sql, org, job, anna.membershipId);
  const [inv] = await api.sql<{ id: string }>(
    "insert into public.invoices (organization_id, client_id, status, amount_cents) values ($1, $2, 'sent', 20000) returning id",
    [org, client],
  );
  const [est] = await api.sql<{ id: string }>(
    "insert into public.estimates (organization_id, client_id, status, total_cents) values ($1, $2, 'sent', 30000) returning id",
    [org, client],
  );
  return { org, owner, olha, anna, ivan, client, job, invoice: inv.id, estimate: est.id };
}

describe.skipIf(!hasPostgrest)("the production catch-up migration", () => {
  it("closes what production leaves open, keeps the everyday edits working, and leaves no drift", async () => {
    await api.db.exec(PRODUCTION_TODAY);
    const before = await company();
    const elsewhere = await addClient(api.sql, await addOrg(api.sql, "Other Co"), "Not Theirs");

    const value = async (table: string, col: string, id: string) =>
      (await api.sql<{ v: number }>(`select ${col} as v from public.${table} where id = $1`, [id]))[0].v;

    // Production today. Bookings: a cleaner who isn't on the job can read it,
    // so she can change anything on it, the price included.
    expect((await changed(before.ivan.userId, "bookings", before.job, { total_cents: 1 })).rows, "the bookings hole").toHaveLength(1);
    expect(await value("bookings", "total_cents", before.job)).toBe(1);
    // Invoices: she can't read them (the Nov 10 office-only read rule), so an
    // edit aimed at one finds nothing...
    expect((await changed(before.ivan.userId, "invoices", before.invoice, { amount_cents: 1 })).rows).toHaveLength(0);
    // ...but an edit with no filter needs no read, and rewrites every invoice
    // in her company. (Whether production's API refuses filterless edits is
    // a setting this stack can't show; the catch-up closes it either way.)
    expect((await blindEdit(before.ivan.userId, "invoices", { amount_cents: 2 })).status).toBe(204);
    expect(await value("invoices", "amount_cents", before.invoice), "the invoices hole").toBe(2);

    await api.db.exec(readFileSync(join(MIGRATIONS_DIR, "20261116070000_catch_up_production.sql"), "utf8"));
    const c = await company();
    const amount = value;

    // A cleaner who isn't on the job reaches none of it, aimed or blind.
    expect((await changed(c.ivan.userId, "invoices", c.invoice, { amount_cents: 1 })).rows).toHaveLength(0);
    expect((await changed(c.ivan.userId, "estimates", c.estimate, { total_cents: 1 })).rows).toHaveLength(0);
    expect((await changed(c.ivan.userId, "bookings", c.job, { notes: "Ivan was here" })).rows).toHaveLength(0);
    await blindEdit(c.ivan.userId, "invoices", { amount_cents: 3 });
    await blindEdit(c.ivan.userId, "estimates", { total_cents: 3 });
    await blindEdit(c.ivan.userId, "bookings", { total_cents: 3 });
    expect([await amount("invoices", "amount_cents", c.invoice), await amount("estimates", "total_cents", c.estimate), await amount("bookings", "total_cents", c.job)]).toEqual([
      20000, 30000, 20000,
    ]);

    // The cleaner on the job can update its status and notes, and nothing else.
    const crewEdit = await changed(c.anna.userId, "bookings", c.job, { status: "in_progress", notes: "on my way" });
    expect(crewEdit.rows, `${crewEdit.status} ${crewEdit.text}`).toHaveLength(1);
    expect((await changed(c.anna.userId, "bookings", c.job, { total_cents: 1 })).status, "the price is the office's").toBeGreaterThanOrEqual(400);
    expect(await amount("bookings", "total_cents", c.job)).toBe(20000);

    // The office's edits still land: a manager on a job she isn't on, an invoice, an estimate.
    expect((await changed(c.olha.userId, "bookings", c.job, { notes: "Gate code 4410" })).rows).toHaveLength(1);
    expect((await changed(c.olha.userId, "invoices", c.invoice, { due_date: "2026-12-15" })).rows).toHaveLength(1);
    expect((await changed(c.olha.userId, "estimates", c.estimate, { notes: "Revised" })).rows).toHaveLength(1);
    expect((await changed(c.owner.userId, "invoices", c.invoice, { amount_cents: 21000 })).rows).toHaveLength(1);

    // A cleaner can't file an approved time-off request for herself.
    const pto = await rest(c.ivan.userId, "POST", "pto_requests", {
      organization_id: c.org,
      employee_id: c.ivan.membershipId,
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      hours: 9999,
      status: "approved",
    });
    expect(pto.status, pto.text).toBeGreaterThanOrEqual(400);
    expect(await api.sql("select 1 from public.pto_requests where employee_id = $1", [c.ivan.membershipId])).toHaveLength(0);

    // Only an owner makes an owner; a booking can't name another company's client.
    // (A manager can't edit memberships at all; an admin can, so the owner
    // guard is what stops an admin from promoting herself.)
    const admin = await addMember(api.sql, c.org, "admin", "Office Admin");
    expect((await changed(admin.userId, "memberships", admin.membershipId, { role: "owner" })).status, "the owner guard").toBeGreaterThanOrEqual(400);
    await changed(c.olha.userId, "memberships", c.olha.membershipId, { role: "owner" });
    const roles = await api.sql<{ role: string }>("select role::text as role from public.memberships where id in ($1, $2) order by role", [
      admin.membershipId,
      c.olha.membershipId,
    ]);
    expect(roles.map((r) => r.role)).toEqual(["admin", "manager"]);
    const stray = await rest(c.owner.userId, "POST", "bookings", {
      organization_id: c.org,
      client_id: elsewhere,
      scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      duration_minutes: 60,
      service_type: "standard",
      status: "pending",
    });
    expect(stray.status, stray.text).toBeGreaterThanOrEqual(400);

    // The profitability report exists again.
    const report = await rest(c.owner.userId, "POST", "rpc/report_job_profitability", {
      p_org: c.org,
      p_from: "2026-11-01T00:00:00Z",
      p_to: "2026-12-01T00:00:00Z",
    });
    expect(report.status, report.text).toBe(200);

    // And the drift check finds nothing left. (regexp_* are the test stack's
    // own shims, which the check leaves out of its list; webhooks were never
    // part of this.)
    const drift = await api.sql<{ drift: string; name: string }>(
      readFileSync(join(MIGRATIONS_DIR, "..", "..", "docs", "production-drift-check.sql"), "utf8"),
    );
    expect(drift.filter((d) => !/^regexp_/.test(d.name))).toEqual([]);
  });

  it("on a database that already matches the migrations, it changes nothing", async () => {
    // This file's other test reshaped and repaired the schema; run it again.
    await api.db.exec(readFileSync(join(MIGRATIONS_DIR, "20261116070000_catch_up_production.sql"), "utf8"));
    const drift = await api.sql<{ drift: string; name: string }>(
      readFileSync(join(MIGRATIONS_DIR, "..", "..", "docs", "production-drift-check.sql"), "utf8"),
    );
    expect(drift.filter((d) => !/^regexp_/.test(d.name))).toEqual([]);
  });
});
