/**
 * Arranging a company for a browser test. Every test makes its own, so no
 * test depends on what another left behind.
 */
import { addBooking, addClient, addMember, addOrg, type Member } from "../db/harness";
import type { Stack } from "./stack";

export type Company = {
  org: string;
  client: string;
  clientName: string;
  owner: Member;
  manager: Member;
  anna: Member;
  bea: Member;
};

let n = 0;

/**
 * One small cleaning company: an owner, a manager, two cleaners (Anna and
 * Bea), one client, two services. Hours are divided between a crew, jobs
 * close themselves two hours after their window, and a finished job drafts
 * its invoice, as Svit runs it.
 *
 * The zone is America/Regina: the same clock Alberta keeps year-round since
 * 2026-11-01, on every machine's time zone data, old or new.
 */
export async function company(stack: Stack, label = "Co"): Promise<Company> {
  const sql = stack.api.sql;
  const tag = `${label} ${++n}`;
  const org = await addOrg(sql, tag);
  await sql(
    `update public.organizations
        set timezone = 'America/Regina', onboarding_completed_at = now(),
            automations_enabled = true, automation_settings = $2::jsonb, booking_auto_complete_hours = 2
      where id = $1`,
    [
      org,
      JSON.stringify({
        divide_crew_hours: { enabled: true },
        auto_complete_past_bookings: { enabled: true },
        auto_invoice_on_job_complete: { enabled: true },
      }),
    ],
  );
  const person = async (role: "owner" | "manager" | "employee", name: string) => {
    const m = await addMember(sql, org, role, name);
    await sql("update public.memberships set display_name = $2 where id = $1", [m.membershipId, name]);
    await sql("update public.profiles set full_name = $2 where id = $1", [m.userId, name]);
    return m;
  };
  const owner = await person("owner", "Olivia Owner");
  const manager = await person("manager", "Mara Manager");
  const anna = await person("employee", "Anna Cleaner");
  const bea = await person("employee", "Bea Cleaner");
  await sql("update public.memberships set pay_rate_cents = 2200 where id = any($1::uuid[])", [
    [anna.membershipId, bea.membershipId],
  ]);
  await sql(
    `insert into public.service_types (organization_id, name, default_duration_minutes, default_price_cents, sort_order)
     values ($1, 'Standard clean', 120, 14000, 1), ($1, 'Deep clean', 240, 32000, 2)`,
    [org],
  );
  const clientName = `Jordan Client ${n}`;
  const client = await addClient(sql, org, clientName);
  await sql("update public.clients set name = $2, address = '12 Test Street', email = $3 where id = $1", [
    client,
    clientName,
    `jordan${n}@example.test`,
  ]);
  return { org, client, clientName, owner, manager, anna, bea };
}

export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
export const daysFromNow = (d: number) => minutesFromNow(d * 24 * 60);

/** A job for the company's client, with this crew (first is the lead), all accepted. */
export async function job(
  stack: Stack,
  c: Company,
  opts: { at?: string; minutes?: number; status?: string; crew?: Member[]; totalCents?: number } = {},
): Promise<string> {
  const sql = stack.api.sql;
  const id = await addBooking(sql, c.org, c.client, {
    scheduledAt: opts.at ?? daysFromNow(1),
    durationMinutes: opts.minutes ?? 120,
    status: opts.status ?? "confirmed",
  });
  await sql("update public.bookings set total_cents = $2, address = '12 Test Street' where id = $1", [
    id,
    opts.totalCents ?? 14000,
  ]);
  const crew = opts.crew ?? [c.anna];
  for (const [i, who] of crew.entries()) {
    await sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       values ($1, $2, $3, $4, 'accepted')`,
      [c.org, id, who.membershipId, i === 0],
    );
  }
  if (crew[0]) await sql("update public.bookings set assigned_to = $2 where id = $1", [id, crew[0].membershipId]);
  return id;
}

/** One value from the database: for checking what a click really did. */
export async function one<T = string>(stack: Stack, text: string, params: unknown[] = []): Promise<T> {
  const rows = await stack.api.sql<Record<string, unknown>>(text, params);
  return Object.values(rows[0] ?? {})[0] as T;
}
