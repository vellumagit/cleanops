/**
 * A recurring series stops naming someone the day she is deactivated
 * (2026-11-14).
 *
 * Deactivating a person took her off her upcoming visits and left every
 * series template that named her alone. The template is what new visits
 * are copied from, so the next batch came out with her on them again: at
 * Svit, 52 upcoming visits led by a placeholder deactivated in May, none
 * of which the office could edit.
 *
 * The real offboarding sweep against the real stack (test/db/api.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

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

async function addSeries(org: string, client: string, lead: Member | null, crew: Member[] | null): Promise<string> {
  const [row] = await api.sql<{ id: string }>(
    `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to, crew)
     values ($1, $2, 'weekly', '09:00', current_date, 120, $3, $4::jsonb) returning id`,
    [
      org,
      client,
      lead?.membershipId ?? null,
      crew ? JSON.stringify(crew.map((m) => ({ membership_id: m.membershipId, start_offset_minutes: null, duration_minutes: null }))) : null,
    ],
  );
  return row.id;
}

const template = async (id: string) =>
  (
    await api.sql<{ assigned_to: string | null; crew: Array<{ membership_id: string }> | null }>(
      "select assigned_to, crew from public.booking_series where id = $1",
      [id],
    )
  )[0];

async function deactivate(org: string, who: Member, name: string) {
  await api.sql("update public.memberships set status = 'disabled' where id = $1", [who.membershipId]);
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { sweepDeactivatedMember } = await import("@/lib/member-offboarding");
  try {
    return await sweepDeactivatedMember(createSupabaseAdminClient(), {
      organizationId: org,
      membershipId: who.membershipId,
      memberName: name,
    });
  } finally {
    await settle();
  }
}

describe.skipIf(!hasPostgrest)("deactivating someone clears her from recurring series", () => {
  it("a series she led alone is left with nobody, and one she shared keeps the rest", async () => {
    const org = await addOrg(api.sql);
    const client = await addClient(api.sql, org);
    const olga = await addMember(api.sql, org, "employee", "Olga");
    const vira = await addMember(api.sql, org, "employee", "Vira");

    const alone = await addSeries(org, client, olga, null);
    const shared = await addSeries(org, client, olga, [olga, vira]);
    const notHers = await addSeries(org, client, vira, [vira]);

    const result = await deactivate(org, olga, "Olga");
    expect(result.seriesCleared).toBe(2);

    expect(await template(alone)).toEqual({ assigned_to: null, crew: null });
    const after = await template(shared);
    expect(after.assigned_to).toBe(vira.membershipId);
    expect((after.crew ?? []).map((m) => m.membership_id)).toEqual([vira.membershipId]);
    // Someone else's series is untouched.
    const other = await template(notHers);
    expect(other.assigned_to).toBe(vira.membershipId);
    expect((other.crew ?? []).map((m) => m.membership_id)).toEqual([vira.membershipId]);
  });

  it("another company's series naming the same id is not touched", async () => {
    const org = await addOrg(api.sql);
    const client = await addClient(api.sql, org);
    const olga = await addMember(api.sql, org, "employee", "Olga");
    const mine = await addSeries(org, client, olga, null);

    const elsewhere = await addOrg(api.sql);
    const theirClient = await addClient(api.sql, elsewhere);
    const theirs = await addMember(api.sql, elsewhere, "employee", "Theirs");
    const theirSeries = await addSeries(elsewhere, theirClient, theirs, null);

    await deactivate(org, olga, "Olga");
    expect((await template(mine)).assigned_to).toBeNull();
    expect((await template(theirSeries)).assigned_to).toBe(theirs.membershipId);
  });
});
