/**
 * A cleaner's weekly hours: what is saved is what was sent, or nothing is
 * (2026-11-14).
 *
 * Saving replaces the whole week: delete, then insert. The save used to
 * skip a row it did not like (an end before its start) without a word and
 * report success, so the week was saved with that day missing. It now
 * refuses the whole save with the reason, before anything is deleted.
 *
 * The real actions against the real stack (test/db/api.ts), signed in as
 * the cleaner.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let actions: typeof import("@/app/field/availability/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  actions = await import("@/app/field/availability/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

async function as<T>(who: Member, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

const saveWeek = (who: Member, lines: string[]) =>
  as(who, () => {
    const form = new FormData();
    for (const line of lines) form.append("slots", line);
    return actions.saveAvailabilitySlotsAction(form);
  });

/** The week as the page would load it: the database's own text for a time. */
const loadWeek = (who: Member) =>
  api.sql<{ day_of_week: number; start_time: string; end_time: string }>(
    "select day_of_week, start_time::text, end_time::text from public.availability_slots where membership_id = $1 order by day_of_week, start_time",
    [who.membershipId],
  );

describe.skipIf(!hasPostgrest)("availability: a cleaner's weekly hours", () => {
  it("saving the week as it was loaded keeps every day", async () => {
    const org = await addOrg(api.sql);
    const olha = await addMember(api.sql, org, "employee", "Olha");

    expect(await saveWeek(olha, ["1|09:00|17:00", "2|09:00|17:00", "3|09:00|12:00", "3|13:00|17:00"])).toEqual({ ok: true });
    const first = await loadWeek(olha);
    expect(first).toHaveLength(4);

    // She reopens the page and changes Tuesday. Everything else goes back
    // exactly as it came out of the database; Wednesday is sent the way
    // some browsers' time inputs report it, with seconds.
    const resend = first.map((r) =>
      r.day_of_week === 2
        ? "2|10:00|14:00"
        : r.day_of_week === 3
          ? `3|${r.start_time}:00|${r.end_time}:00`
          : `${r.day_of_week}|${r.start_time}|${r.end_time}`,
    );
    expect(await saveWeek(olha, resend)).toEqual({ ok: true });

    expect(await loadWeek(olha)).toEqual([
      { day_of_week: 1, start_time: "09:00", end_time: "17:00" },
      { day_of_week: 2, start_time: "10:00", end_time: "14:00" },
      { day_of_week: 3, start_time: "09:00", end_time: "12:00" },
      { day_of_week: 3, start_time: "13:00", end_time: "17:00" },
    ]);
  });

  it("one bad time refuses the save and leaves the week alone", async () => {
    const org = await addOrg(api.sql);
    const olha = await addMember(api.sql, org, "employee", "Olha");
    expect(await saveWeek(olha, ["1|09:00|17:00", "5|09:00|17:00"])).toEqual({ ok: true });

    const backwards = await saveWeek(olha, ["1|09:00|17:00", "5|17:00|09:00"]);
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error).toMatch(/after the start/);

    const garbage = await saveWeek(olha, ["1|09:00|17:00", "5|soon|later"]);
    expect(garbage.ok).toBe(false);

    // Both days still there: nothing was deleted on the way to refusing.
    expect((await loadWeek(olha)).map((r) => r.day_of_week)).toEqual([1, 5]);
  });

  it("switching every day off clears the week", async () => {
    const org = await addOrg(api.sql);
    const olha = await addMember(api.sql, org, "employee", "Olha");
    expect(await saveWeek(olha, ["1|09:00|17:00"])).toEqual({ ok: true });
    expect(await saveWeek(olha, [])).toEqual({ ok: true });
    expect(await loadWeek(olha)).toEqual([]);
  });

  it("a cleaner cannot set another cleaner's hours", async () => {
    const org = await addOrg(api.sql);
    const olha = await addMember(api.sql, org, "employee", "Olha");
    const vira = await addMember(api.sql, org, "employee", "Vira");
    expect(await saveWeek(vira, ["1|09:00|17:00"])).toEqual({ ok: true });

    const res = await as(olha, () => {
      const form = new FormData();
      form.set("membership_id", vira.membershipId);
      form.append("slots", "2|08:00|09:00");
      return actions.saveAvailabilitySlotsAction(form);
    });
    expect(res.ok).toBe(false);
    expect((await loadWeek(vira)).map((r) => r.day_of_week)).toEqual([1]);
  });
});
