/**
 * Claiming an offered shift while already booked elsewhere (2026-11-14).
 *
 * A roster member who claims a shift is put on the job's crew. The overlap
 * guard refuses a crew row that clashes with another of their jobs, and that
 * refusal arrived after the spot was taken and was swallowed: the page said
 * the shift was theirs, the offer counted as filled, and nobody was on the
 * job. Found by reading every write the guard can refuse, not from a report.
 *
 * The real action against the real stack (test/db/api.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addMember, addOrg, type Member } from "./harness";
import { request } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let claim: typeof import("@/app/claim/[token]/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  claim = await import("@/app/claim/[token]/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const at = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function clientNamed(org: string, name: string): Promise<string> {
  const [row] = await api.sql<{ id: string }>(
    "insert into public.clients (organization_id, name) values ($1, $2) returning id",
    [org, name],
  );
  return row.id;
}

async function putOn(org: string, booking: string, who: Member) {
  await api.sql(
    "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
    [org, booking, who.membershipId],
  );
  await api.sql("update public.bookings set assigned_to = $2 where id = $1", [booking, who.membershipId]);
}

let n = 0;
async function offerTo(org: string, booking: string, poster: Member, who: Member): Promise<{ offer: string; token: string }> {
  const [offer] = await api.sql<{ id: string }>(
    `insert into public.job_offers (organization_id, booking_id, posted_by, pay_cents, status, positions_needed, positions_filled)
     values ($1, $2, $3, 0, 'open', 1, 0) returning id`,
    [org, booking, poster.membershipId],
  );
  const token = `claimtest${String(++n).padStart(7, "0")}`;
  await api.sql(
    `insert into public.job_offer_dispatches (organization_id, offer_id, membership_id, claim_token)
     values ($1, $2, $3, $4)`,
    [org, offer.id, who.membershipId, token],
  );
  return { offer: offer.id, token };
}

describe.skipIf(!hasPostgrest)("claiming an offered shift", () => {
  it("a free cleaner claims it and is on the job", async () => {
    const org = await addOrg(api.sql, "Free Co");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const vira = await addMember(api.sql, org, "employee", "Vira");
    const job = await addBooking(api.sql, org, await clientNamed(org, "Open Shift"), { scheduledAt: at(5, 16), durationMinutes: 180 });
    const { offer, token } = await offerTo(org, job, owner, vira);

    expect(await claim.claimOfferAction(token)).toMatchObject({ ok: true });
    const crew = await api.sql<{ membership_id: string }>("select membership_id from public.booking_assignees where booking_id = $1", [job]);
    expect(crew.map((c) => c.membership_id)).toEqual([vira.membershipId]);
    const [o] = await api.sql<{ status: string }>("select status from public.job_offers where id = $1", [offer]);
    expect(o.status).toBe("filled");
    // A one-off visit is never marked: there is no series to save over it.
    const [mark] = await api.sql<{ crew_set_by_hand_at: string | null }>(
      "select crew_set_by_hand_at from public.bookings where id = $1",
      [job],
    );
    expect(mark.crew_set_by_hand_at).toBeNull();
  });

  it("a claimed visit of a series is marked as having its own crew, so a series save asks before overriding it", async () => {
    const org = await addOrg(api.sql, "Series Claim Co");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const vira = await addMember(api.sql, org, "employee", "Vira");
    const client = await clientNamed(org, "Weekly Client");
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes)
       values ($1, $2, 'weekly', '16:00', current_date, 180) returning id`,
      [org, client],
    );
    const job = await addBooking(api.sql, org, client, { scheduledAt: at(5, 16), durationMinutes: 180 });
    await api.sql("update public.bookings set series_id = $2 where id = $1", [job, series.id]);
    const { token } = await offerTo(org, job, owner, vira);

    expect(await claim.claimOfferAction(token)).toMatchObject({ ok: true });
    const [mark] = await api.sql<{ crew_set_by_hand_at: string | null }>(
      "select crew_set_by_hand_at from public.bookings where id = $1",
      [job],
    );
    expect(mark.crew_set_by_hand_at).not.toBeNull();
  });

  it("a cleaner already booked then is told which job, and the spot stays open", async () => {
    const org = await addOrg(api.sql, "Busy Co");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const olha = await addMember(api.sql, org, "employee", "Olha");
    const other = await addBooking(api.sql, org, await clientNamed(org, "Leslie Saumer"), { scheduledAt: at(5, 16), durationMinutes: 240 });
    await putOn(org, other, olha);
    const job = await addBooking(api.sql, org, await clientNamed(org, "Open Shift"), { scheduledAt: at(5, 17), durationMinutes: 180 });
    const { offer, token } = await offerTo(org, job, owner, olha);

    const result = await claim.claimOfferAction(token);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: "error" });
    expect((result as { message?: string }).message).toContain("You're already booked then: Leslie Saumer");

    const [o] = await api.sql<{ status: string; positions_filled: number }>(
      "select status, positions_filled from public.job_offers where id = $1",
      [offer],
    );
    expect(o).toMatchObject({ status: "open", positions_filled: 0 });
    expect(await api.sql("select 1 from public.job_offer_claims where offer_id = $1", [offer])).toEqual([]);
    expect(await api.sql("select 1 from public.booking_assignees where booking_id = $1", [job])).toEqual([]);
  });

  it("a link sent to someone since deactivated no longer works, and the spot stays open", async () => {
    const org = await addOrg(api.sql, "Gone Co");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const olga = await addMember(api.sql, org, "employee", "Olga");
    const job = await addBooking(api.sql, org, await clientNamed(org, "Open Shift"), { scheduledAt: at(5, 16), durationMinutes: 180 });
    const { offer, token } = await offerTo(org, job, owner, olga);
    await api.sql("update public.memberships set status = 'disabled' where id = $1", [olga.membershipId]);

    expect(await claim.claimOfferAction(token)).toEqual({ ok: false, reason: "invalid" });
    const [o] = await api.sql<{ status: string; positions_filled: number }>(
      "select status, positions_filled from public.job_offers where id = $1",
      [offer],
    );
    expect(o).toMatchObject({ status: "open", positions_filled: 0 });
    expect(await api.sql("select 1 from public.booking_assignees where booking_id = $1", [job])).toEqual([]);
  });

  it("a job straight after her other one is not a clash", async () => {
    const org = await addOrg(api.sql, "Back To Back Co");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const olha = await addMember(api.sql, org, "employee", "Olha");
    const other = await addBooking(api.sql, org, await clientNamed(org, "Morning"), { scheduledAt: at(5, 15), durationMinutes: 120 });
    await putOn(org, other, olha);
    const job = await addBooking(api.sql, org, await clientNamed(org, "Afternoon"), { scheduledAt: at(5, 17), durationMinutes: 120 });
    const { token } = await offerTo(org, job, owner, olha);
    expect(await claim.claimOfferAction(token)).toMatchObject({ ok: true });
  });
});
