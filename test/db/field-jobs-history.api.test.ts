/**
 * The field app's Today and Shifts screens (fetchMyFieldJobs) for someone
 * with a long history, against a real database behind the real PostgREST.
 *
 * They used to read every crew row the person had ever held and send all
 * those job ids back in one request. Past about 390 ids production refuses
 * the address, the read fails, and the screen crashes: Olha, 428 crew rows,
 * on 2026-11-16. The stack refuses long addresses the same way
 * (MAX_URL_BYTES), so the old code fails this test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());

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

describe.skipIf(!hasPostgrest)("the field app for someone with a long history", () => {
  it("450 jobs behind her and 30 ahead: Today lists yesterday's and the 30, with her crew size on the team job", async () => {
    const { fetchMyFieldJobs } = await import("@/app/field/jobs/data");
    const org = await addOrg(api.sql, "History Co");
    await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
    const client = await addClient(api.sql, org);
    const olha = await addMember(api.sql, org, "manager", "Olha");
    const bea = await addMember(api.sql, org, "employee", "Bea");
    // One job a day: 450 days behind, 30 ahead, the first one ahead a team job.
    await api.sql(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, total_cents, assigned_to)
       select $1, $2, date_trunc('day', now()) + make_interval(days => d, hours => 9), 120, 'standard',
              (case when d < 0 then 'completed' else 'confirmed' end)::public.booking_status, 14000, $3
         from generate_series(-450, 30) d where d <> 0`,
      [org, client, olha.membershipId],
    );
    await api.sql(
      `insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status)
       select organization_id, id, assigned_to, true, 'accepted' from public.bookings where organization_id = $1`,
      [org],
    );
    const [team] = await api.sql<{ id: string }>(
      "select id from public.bookings where organization_id = $1 and scheduled_at > now() order by scheduled_at limit 1",
      [org],
    );
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary, acceptance_status) values ($1, $2, $3, false, 'accepted')",
      [org, team.id, bea.membershipId],
    );

    request.cookies = api.sessionCookies(olha.userId);
    try {
      const { jobs } = await fetchMyFieldJobs({
        id: olha.membershipId,
        organization_id: org,
        organization_name: "History Co",
        role: "manager",
        status: "active",
        profile_id: olha.userId,
        capabilities: null as never,
      });
      // From yesterday on (an overnight or overdue job stays in view), so
      // yesterday's job and the thirty ahead.
      expect(jobs).toHaveLength(31);
      expect(jobs.every((j) => new Date(j.scheduled_at) > new Date(Date.now() - 2 * 86_400_000))).toBe(true);
      expect(jobs.find((j) => j.id === team.id)).toMatchObject({ crew_size: 2 });
      expect(jobs.filter((j) => j.id !== team.id).every((j) => j.crew_size === 1)).toBe(true);
    } finally {
      await settle();
    }
  });
});
