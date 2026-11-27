/**
 * The two daily checks added on 2026-11-14, against the real stack
 * (test/db/api.ts):
 *
 *   - "things that don't add up": upcoming visits whose own details
 *     disagree with where they came from (src/lib/mismatch-check.ts)
 *   - what the app refused: every error message shown to a signed-in person
 *     (/api/refusals, refusal_log)
 *
 * and that the morning report prints both.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addMember, addOrg, type Member } from "./harness";
import { request } from "./next-stubs";

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

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

async function clientNamed(org: string, name: string, address: string | null): Promise<string> {
  const [row] = await api.sql<{ id: string }>(
    "insert into public.clients (organization_id, name, address) values ($1, $2, $3) returning id",
    [org, name, address],
  );
  return row.id;
}

async function visit(org: string, client: string, opts: { inDays: number; address?: string | null; crew?: Member[]; status?: string }) {
  const id = await addBooking(api.sql, org, client, { scheduledAt: inDays(opts.inDays), durationMinutes: 120, status: opts.status ?? "confirmed" });
  await api.sql("update public.bookings set address = $2 where id = $1", [id, opts.address ?? null]);
  for (const [i, m] of (opts.crew ?? []).entries()) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, $4)",
      [org, id, m.membershipId, i === 0],
    );
    if (i === 0) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, m.membershipId]);
  }
  return id;
}

async function admin() {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  return createSupabaseAdminClient();
}

describe.skipIf(!hasPostgrest)("things that don't add up", () => {
  it("finds the stale address, the deactivated cleaner, the series naming her, and the unstaffed visit this week", async () => {
    const org = await addOrg(api.sql, "Company");
    const olha = await addMember(api.sql, org, "employee", "Olha");
    const olga = await addMember(api.sql, org, "employee", "Olga");
    await api.sql("update public.memberships set display_name = 'Olga Placeholder' where id = $1", [olga.membershipId]);

    const hilda = await clientNamed(org, "Hilda Daubner", "6315 135 Avenue NW");
    const staleAddress = await visit(org, hilda, { inDays: 3, address: "13825 155 Avenue NW", crew: [olha] });

    const nancy = await clientNamed(org, "Nancy Ellestad", "12 Elm Street");
    const ghostCrew = await visit(org, nancy, { inDays: 16, address: "12 Elm St", crew: [olga] });
    const [series] = await api.sql<{ id: string }>(
      `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, duration_minutes, assigned_to)
       values ($1, $2, 'bi_weekly', '09:00', current_date, 120, $3) returning id`,
      [org, nancy, olga.membershipId],
    );
    await api.sql("update public.memberships set status = 'disabled' where id = $1", [olga.membershipId]);

    const stacie = await clientNamed(org, "Stacie Moore", "9 Oak Road");
    const nobodySoon = await visit(org, stacie, { inDays: 5, address: "9 Oak Road" });
    // Not findings: nobody yet on a visit months away, a finished job at an
    // old address, and a visit that agrees with its client.
    await visit(org, stacie, { inDays: 60, address: "9 Oak Road" });
    await visit(org, hilda, { inDays: -10, address: "13825 155 Avenue NW", crew: [olha], status: "completed" });
    await visit(org, hilda, { inDays: 20, address: "6315 135 Ave NW", crew: [olha] });

    const { loadMismatches } = await import("@/lib/mismatch-check");
    const { found, errors } = await loadMismatches(await admin(), org, Date.now());
    expect(errors).toEqual([]);
    const got = found.map((m) => `${m.kind}:${m.id}`).sort();
    expect(got).toEqual(
      [
        `address:${staleAddress}`,
        `inactive_crew:${ghostCrew}`,
        `series_inactive_crew:${series.id}`,
        `unassigned_soon:${nobodySoon}`,
      ].sort(),
    );
    expect(found.find((m) => m.kind === "inactive_crew")?.detail).toBe("Olga Placeholder");
  });

  it("lists a double-booking that was already there, which the overlap guard lets stand", async () => {
    const org = await addOrg(api.sql, "Doubled");
    const olha = await addMember(api.sql, org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha Musnytska' where id = $1", [olha.membershipId]);
    const leslie = await clientNamed(org, "Leslie Saumer", "1 First Street");
    const amanda = await clientNamed(org, "Amanda SJ", "2 Second Street");
    const first = await visit(org, leslie, { inDays: 4, address: "1 First Street", crew: [olha] });
    const second = await visit(org, amanda, { inDays: 6, address: "2 Second Street", crew: [olha] });
    // Clear, and a clash months out is not this report's business.
    await visit(org, amanda, { inDays: 8, address: "2 Second Street", crew: [olha] });

    // The guard refuses this move today. Bookings made before it shipped are
    // in this state anyway, so put one there the way they got there: with
    // the guard not looking.
    await api.sql("alter table public.bookings disable trigger user");
    try {
      await api.sql(
        "update public.bookings set scheduled_at = (select scheduled_at + interval '1 hour' from public.bookings where id = $2) where id = $1",
        [second, first],
      );
    } finally {
      await api.sql("alter table public.bookings enable trigger user");
    }

    const { loadMismatches } = await import("@/lib/mismatch-check");
    const { found, errors } = await loadMismatches(await admin(), org, Date.now());
    expect(errors).toEqual([]);
    expect(found.map((m) => m.kind)).toEqual(["double_booked"]);
    expect(found[0].client).toBe("Olha Musnytska: Leslie Saumer and Amanda SJ");
  });

  // The report's times are the overlap guard's, and the guard reads "divide
  // crew hours" on its own, automations paused or not (migration
  // 20261110020000). The report also required automations to be on, so a
  // company with them paused got double-bookings listed that the guard, and
  // every booking screen, called fine.
  it("with automations paused and the crew's hours shared, a pair the guard allows is not listed", async () => {
    const org = await addOrg(api.sql, "Paused");
    await api.sql(
      `update public.organizations set automations_enabled = false,
              automation_settings = '{"divide_crew_hours": {"enabled": true}}'::jsonb where id = $1`,
      [org],
    );
    const olha = await addMember(api.sql, org, "employee", "Olha");
    const vira = await addMember(api.sql, org, "employee", "Vira");
    const leslie = await clientNamed(org, "Leslie Saumer", "1 First Street");
    const amanda = await clientNamed(org, "Amanda SJ", "2 Second Street");
    // Two hours, two people: an hour each.
    const first = await visit(org, leslie, { inDays: 4, address: "1 First Street", crew: [olha, vira] });
    const [{ at: firstAt }] = await api.sql<{ at: string }>("select scheduled_at as at from public.bookings where id = $1", [first]);
    // Olha's next job an hour and a quarter in: clear of her hour. The
    // guard lets it in, which says the same.
    const second = await addBooking(api.sql, org, amanda, {
      scheduledAt: new Date(new Date(firstAt).getTime() + 75 * 60_000).toISOString(),
      durationMinutes: 120,
      status: "confirmed",
    });
    await api.sql("update public.bookings set address = '2 Second Street', assigned_to = $2 where id = $1", [second, olha.membershipId]);
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
      [org, second, olha.membershipId],
    );

    const { loadMismatches } = await import("@/lib/mismatch-check");
    const { found, errors } = await loadMismatches(await admin(), org, Date.now());
    expect(errors).toEqual([]);
    expect(found.filter((m) => m.kind === "double_booked")).toEqual([]);
  });

  it("another company's visits are not in this company's list", async () => {
    const mine = await addOrg(api.sql, "Mine");
    const theirs = await addOrg(api.sql, "Theirs");
    const c = await clientNamed(theirs, "Their Client", "1 New Road");
    await visit(theirs, c, { inDays: 2, address: "99 Old Lane" });

    const { loadMismatches } = await import("@/lib/mismatch-check");
    expect((await loadMismatches(await admin(), mine, Date.now())).found).toEqual([]);
    expect((await loadMismatches(await admin(), theirs, Date.now())).found.map((m) => m.kind).sort()).toEqual([
      "address",
      "unassigned_soon",
    ]);
  });
});

describe.skipIf(!hasPostgrest)("what the app refused", () => {
  const post = async (who: Member | null, items: unknown[]) => {
    request.cookies = who ? api.sessionCookies(who.userId) : [];
    const { POST } = await import("@/app/api/refusals/route");
    return POST(
      new NextRequest("http://localhost/api/refusals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      }),
    );
  };
  const rowsFor = (org: string) =>
    api.sql<{ membership_id: string | null; path: string; kind: string; message: string }>(
      "select membership_id, path, kind, message from public.refusal_log where organization_id = $1 order by created_at, message",
      [org],
    );

  it("keeps the words, the screen and who saw them", async () => {
    const org = await addOrg(api.sql, "Company");
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");

    const res = await post(svitlana, [
      {
        message: "Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM. Nothing was changed.",
        path: "/app/bookings/ee5a9bf7-64cd-409a-b679-636855e8f5fe/edit?_return=%2Fapp%2Fscheduling",
        kind: "alert",
      },
      { message: "Couldn't save.", path: "/app/clients", kind: "toast" },
    ]);
    expect(res.status).toBe(204);
    expect(await rowsFor(org)).toEqual([
      { membership_id: svitlana.membershipId, path: "/app/clients", kind: "toast", message: "Couldn't save." },
      {
        membership_id: svitlana.membershipId,
        path: "/app/bookings/:id/edit",
        kind: "alert",
        message: "Olha Musnytska is already booked then: Nancy Whitson, Dec 4, 2026 · 9:00 AM. Nothing was changed.",
      },
    ]);
  });

  it("nobody signed in, an empty message, or junk stores nothing and still answers quietly", async () => {
    const org = await addOrg(api.sql, "Company");
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");

    expect((await post(null, [{ message: "Something failed.", path: "/app", kind: "toast" }])).status).toBe(204);
    expect((await post(svitlana, [{ message: "  ", path: "/app" }, { nothing: true }, null])).status).toBe(204);
    expect((await post(svitlana, [])).status).toBe(204);
    expect(await rowsFor(org)).toEqual([]);
  });

  it("a long message is cut, and one request can't flood the table", async () => {
    const org = await addOrg(api.sql, "Company");
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");

    await post(
      svitlana,
      Array.from({ length: 40 }, (_, i) => ({ message: `Refusal number ${i} ${"x".repeat(900)}`, path: "/app", kind: "toast" })),
    );
    const rows = await rowsFor(org);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.message.length === 600)).toBe(true);
  });

  it("one person can only add so many in ten minutes", async () => {
    const org = await addOrg(api.sql, "Company");
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");
    const olha = await addMember(api.sql, org, "employee", "Olha");
    for (let batch = 0; batch < 9; batch++) {
      await post(
        svitlana,
        Array.from({ length: 10 }, (_, i) => ({ message: `Looping refusal ${batch}-${i}`, path: "/app", kind: "toast" })),
      );
    }
    // Someone else in the same company is not held back by her.
    await post(olha, [{ message: "Could not save the job.", path: "/field/jobs", kind: "toast" }]);
    const rows = await rowsFor(org);
    expect(rows.filter((r) => r.membership_id === svitlana.membershipId)).toHaveLength(60);
    expect(rows.filter((r) => r.membership_id === olha.membershipId)).toHaveLength(1);
  });

  it("the table is closed to signed-in people: nobody reads errors through the API", async () => {
    const org = await addOrg(api.sql, "Company");
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");
    await post(svitlana, [{ message: "Something failed.", path: "/app", kind: "toast" }]);

    // Through the API as the owner herself, and with the public key: no rows,
    // though the row is there.
    for (const token of [api.tokenFor(svitlana.userId), api.anonKey]) {
      const res = await fetch(`${api.url}/rest/v1/refusal_log?select=id`, {
        headers: { apikey: api.anonKey, Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as unknown;
      expect(Array.isArray(body) ? body : []).toEqual([]);
    }
    expect(await rowsFor(org)).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("the morning report prints both", () => {
  it("lists the mismatch and yesterday's refusals, and raises them", async () => {
    const org = await addOrg(api.sql, "Company");
    await api.sql("update public.organizations set timezone = 'UTC' where id = $1", [org]);
    const svitlana = await addMember(api.sql, org, "owner", "Svitlana");
    const hilda = await clientNamed(org, "Hilda Daubner", "6315 135 Avenue NW");
    await visit(org, hilda, { inDays: 3, address: "13825 155 Avenue NW", crew: [svitlana] });
    for (let i = 0; i < 6; i++) {
      await api.sql(
        "insert into public.refusal_log (organization_id, membership_id, path, kind, message) values ($1, $2, '/app/bookings', 'alert', $3)",
        [org, svitlana.membershipId, `Olha Musnytska is already booked then: Client ${i}, Dec ${i + 1}, 2026 · 9:00 AM. Nothing was changed.`],
      );
    }

    const { runMorningCheck } = await import("@/lib/morning-check");
    const report = await runMorningCheck(await admin(), { orgId: org });
    const text = report.lines.join("\n");
    expect(text).toContain("7. DON'T ADD UP (1 upcoming visits checked): 1");
    expect(text).toContain("Hilda Daubner");
    expect(text).toContain("8. THE APP SAID NO (last 36h): 6");
    expect(text).toContain("×6");
    expect(report.flags.some((f) => f.includes("don't add up"))).toBe(true);
    expect(report.flags.some((f) => f.includes("refused people 6 time"))).toBe(true);
  });
});
