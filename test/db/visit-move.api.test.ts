/**
 * A client moves their own visit to another open time, and the company's
 * notice period (roadmap phase 4, 2026-11-22).
 *
 * The real actions behind the private link in a booking email, on a real
 * database, as someone with no sign-in: what times they are offered, what
 * a move changes and who hears, and every case where the answer is "call
 * us" instead.
 *
 * Real clock; days are a few out on Regina's calendar (UTC-6 all year),
 * the company open every day nine to five with hourly starts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addCrew, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
  sendOrgEmailDetailed: async () => ({ ok: true }),
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async () => 1,
}));
vi.mock("@/lib/rate-limit-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit-helpers")>()),
  checkIpRateLimit: async () => ({ allowed: true }),
}));

let api: Api;
let restoreEnv: () => void;
let acts: typeof import("@/app/v/[token]/actions");
let links: typeof import("@/lib/visit-link");
let settings: typeof import("@/app/app/settings/online-booking/actions");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  acts = await import("@/app/v/[token]/actions");
  links = await import("@/lib/visit-link");
  settings = await import("@/app/app/settings/online-booking/actions");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
});

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
async function as<T>(who: Member | null, press: () => Promise<T>): Promise<T> {
  request.cookies = who ? api.sessionCookies(who.userId) : [];
  try {
    return await press();
  } finally {
    await settle();
  }
}

const dayOut = (n: number) => new Date(Date.now() - 6 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const regina = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`) + 6 * 3_600_000;
const iso = (ymd: string, hhmm: string) => new Date(regina(ymd, hhmm)).toISOString();
const D = dayOut(5);
const NEXT = dayOut(6);

let seq = 0;
type Mode = "off" | "approve" | "instant";
type Co = { org: string; owner: Member; admin: Member; manager: Member; anna: Member; bea: Member; client: string };
async function company(mode: Mode = "instant", opts: { page?: boolean; sharesHours?: boolean } = {}): Promise<Co> {
  const org = await addOrg(api.sql, "Move Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true, automation_settings = $2::jsonb where id = $1", [
    org,
    JSON.stringify({ divide_crew_hours: { enabled: opts.sharesHours === true } }),
  ]);
  const c: Co = {
    org,
    owner: await addMember(api.sql, org, "owner", "Olivia"),
    admin: await addMember(api.sql, org, "admin", "Adam"),
    manager: await addMember(api.sql, org, "manager", "Mara"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    client: await addClient(api.sql, org, "Jordan Client"),
  };
  if (opts.page !== false) {
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [{ start: "09:00", end: "17:00" }]]));
    await api.sql(
      "insert into public.booking_pages (organization_id, slug, status, time_booking, opening_hours, slot_step_minutes, gap_minutes, min_notice_hours) values ($1, $2, 'published', $3, $4::jsonb, 60, 30, 24)",
      [org, `move-${Date.now().toString(36)}-${++seq}`, mode, JSON.stringify(hours)],
    );
  }
  return c;
}
/** A confirmed two-hour visit for the company's client with this crew, and its private link's token. */
async function visit(c: Co, at: string, crew: Member[], opts: { status?: string; minutes?: number } = {}) {
  const id = await addBooking(api.sql, c.org, c.client, { scheduledAt: at, durationMinutes: opts.minutes ?? 120, status: opts.status ?? "confirmed" });
  for (const m of crew) await addCrew(api.sql, c.org, id, m.membershipId);
  if (crew[0]) await api.sql("update public.bookings set assigned_to = $2 where id = $1", [id, crew[0].membershipId]);
  const token = (await links.visitLinkFor(id))!.split("/v/")[1];
  return { id, token };
}
const times = (token: string, from: string | null = null) => as(null, () => acts.visitTimesAction(token, from));
async function labelsOn(token: string, ymd: string) {
  const res = await times(token, ymd);
  return res.days.find((d) => d.ymd === ymd)?.times.map((t) => t.label) ?? [];
}
const moveTo = (token: string, at: number | string) => as(null, () => acts.visitMoveToAction({}, form({ token, at: String(at) })));
const row = async (id: string) =>
  (await api.sql<{ at: string; status: string; lead: string | null; by_hand: boolean }>(
    "select scheduled_at as at, status::text as status, assigned_to as lead, time_set_by_hand_at is not null as by_hand from public.bookings where id = $1",
    [id],
  ))[0];
const ASK = "To move this visit, ask us and we'll find a time with you.";

describe.skipIf(!hasPostgrest)("moving a visit to another open time", { timeout: 120_000 }, () => {
  it("offers the times its own cleaner is free, never the time it already has, and moves it", async () => {
    const c = await company();
    const v = await visit(c, iso(D, "10:00"), [c.anna]);
    // Anna doesn't take online bookings: it is her visit, so it is her times.
    const shown = await times(v.token);
    expect(shown.error).toBeUndefined();
    expect(JSON.stringify(shown)).not.toContain(c.anna.membershipId);
    // Its own two hours don't stand in its way; only 10:00 itself is left out.
    expect(await labelsOn(v.token, D)).toEqual(["9:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"]);
    // Another job of Anna's, the next morning, does (with the half-hour gap).
    const other = await addBooking(api.sql, c.org, await addClient(api.sql, c.org, "Someone Else"), { scheduledAt: iso(NEXT, "09:00"), durationMinutes: 120 });
    await addCrew(api.sql, c.org, other, c.anna.membershipId);
    expect(await labelsOn(v.token, NEXT)).toEqual(["12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"]);

    const moved = await moveTo(v.token, regina(NEXT, "14:00"));
    expect(moved.error, api.log()).toBeUndefined();
    expect(moved.moved?.when).toMatch(/ at 2:00 PM$/);
    const after = await row(v.id);
    expect(Date.parse(after.at)).toBe(regina(NEXT, "14:00"));
    expect(after).toMatchObject({ status: "confirmed", lead: c.anna.membershipId, by_hand: true });
    expect(await api.sql("select membership_id as m from public.booking_assignees where booking_id = $1", [v.id])).toEqual([{ m: c.anna.membershipId }]);

    // On the record, and the office is told.
    const said = await api.sql<{ body: string; status: string }>("select body, status from public.client_job_requests where booking_id = $1", [v.id]);
    expect(said).toHaveLength(1);
    expect(said[0].status).toBe("resolved");
    expect(said[0].body).toMatch(/^Moved their visit from .+ at 10:00 AM to .+ at 2:00 PM\.$/);
    const told = await api.sql<{ r: string; body: string; href: string }>(
      "select recipient_membership_id as r, body, href from public.notifications where organization_id = $1 and title like 'Jordan Client% moved a visit'",
      [c.org],
    );
    expect(told.map((n) => n.r).sort()).toEqual([c.owner.membershipId, c.admin.membershipId, c.manager.membershipId].sort());
    expect(told[0].href).toBe(`/app/bookings/${v.id}`);
    // The old morning is free for her again.
    const again = await visit(c, iso(dayOut(7), "10:00"), [c.anna]);
    expect(await labelsOn(again.token, D)).toContain("10:00 AM");
  });

  it("only a time that is really open: anything else leaves the visit where it was", async () => {
    const c = await company();
    const v = await visit(c, iso(D, "10:00"), [c.anna]);
    const other = await addBooking(api.sql, c.org, await addClient(api.sql, c.org, "Someone Else"), { scheduledAt: iso(NEXT, "13:00"), durationMinutes: 120 });
    await addCrew(api.sql, c.org, other, c.anna.membershipId);
    for (const at of [regina(NEXT, "13:00"), regina(NEXT, "12:00"), regina(NEXT, "03:00"), regina(NEXT, "10:15"), regina(dayOut(0), "23:00"), regina(dayOut(300), "10:00"), 7]) {
      expect(await moveTo(v.token, at), String(at)).toEqual({ taken: true });
    }
    expect(await moveTo(v.token, "soon")).toEqual({ taken: true });
    expect(await moveTo(v.token, regina(D, "10:00"))).toEqual({ error: "That is the time it is already booked for." });
    expect((await moveTo("not-a-token", regina(NEXT, "09:00"))).error).toMatch(/link has stopped working/);
    expect(Date.parse((await row(v.id)).at)).toBe(regina(D, "10:00"));
    expect(await api.sql("select 1 from public.client_job_requests where booking_id = $1", [v.id])).toEqual([]);
  });

  it("a visit with two cleaners moves only to a time both are free", async () => {
    const c = await company();
    const v = await visit(c, iso(D, "10:00"), [c.anna, c.bea]);
    const other = await addBooking(api.sql, c.org, await addClient(api.sql, c.org, "Someone Else"), { scheduledAt: iso(NEXT, "09:00"), durationMinutes: 180 });
    await addCrew(api.sql, c.org, other, c.bea.membershipId);
    // Bea is busy nine to twelve: nothing before 12:30 for the pair.
    expect(await labelsOn(v.token, NEXT)).toEqual(["1:00 PM", "2:00 PM", "3:00 PM"]);
    expect(await moveTo(v.token, regina(NEXT, "10:00"))).toEqual({ taken: true });
    expect((await moveTo(v.token, regina(NEXT, "13:00"))).moved, api.log()).toBeTruthy();
    const crew = await api.sql<{ m: string }>("select membership_id as m from public.booking_assignees where booking_id = $1 order by 1", [v.id]);
    expect(crew.map((r) => r.m).sort()).toEqual([c.anna.membershipId, c.bea.membershipId].sort());
  });

  it("three moves, then it is a phone call", async () => {
    const c = await company();
    const v = await visit(c, iso(D, "10:00"), [c.anna]);
    for (const hhmm of ["11:00", "12:00", "13:00"]) expect((await moveTo(v.token, regina(NEXT, hhmm))).moved, hhmm).toBeTruthy();
    expect(await moveTo(v.token, regina(NEXT, "14:00"))).toEqual({ error: "This visit has been moved a few times already. To move it again, call us." });
    expect((await times(v.token)).error).toMatch(/moved a few times already/);
    expect(Date.parse((await row(v.id)).at)).toBe(regina(NEXT, "13:00"));
  });
});

describe.skipIf(!hasPostgrest)("when it can't be moved here, it says so", { timeout: 120_000 }, () => {
  it("the company confirms each booking, takes requests only, or has no page: ask instead", async () => {
    for (const co of [await company("approve"), await company("off"), await company("instant", { page: false })]) {
      const v = await visit(co, iso(D, "10:00"), [co.anna]);
      expect(await times(v.token)).toEqual({ days: [], nextFrom: null, error: ASK });
      expect(await moveTo(v.token, regina(NEXT, "14:00"))).toEqual({ error: ASK });
      expect(Date.parse((await row(v.id)).at)).toBe(regina(D, "10:00"));
    }
  });

  it("nobody on it, or people on their own times: ask instead", async () => {
    const c = await company();
    const nobody = await visit(c, iso(D, "10:00"), []);
    expect((await times(nobody.token)).error).toBe(ASK);
    const split = await visit(c, iso(D, "13:00"), [c.anna, c.bea]);
    await api.sql("update public.booking_assignees set split_start_offset_minutes = 0, split_duration_minutes = 60 where booking_id = $1 and membership_id = $2", [split.id, c.anna.membershipId]);
    expect((await times(split.token)).error).toBe(ASK);
    expect(await moveTo(split.token, regina(NEXT, "09:00"))).toEqual({ error: ASK });
  });

  it("a visit that is cancelled, finished, or already under way", async () => {
    const c = await company();
    const cancelled = await visit(c, iso(D, "10:00"), [c.anna], { status: "cancelled" });
    expect((await times(cancelled.token)).error).toBe("This visit was cancelled.");
    const done = await visit(c, new Date(Date.now() - 3 * 3_600_000).toISOString(), [c.bea], { status: "completed" });
    expect((await moveTo(done.token, regina(NEXT, "09:00"))).error).toBe("This visit is finished.");
  });
});

describe.skipIf(!hasPostgrest)("the company's notice period", { timeout: 120_000 }, () => {
  const soon = () => new Date(Date.now() + 30 * 3_600_000).toISOString();
  const setNotice = (c: Co, hours: number) => api.sql("update public.booking_pages set change_notice_hours = $2 where organization_id = $1", [c.org, hours]);

  it("48 hours unless the company says otherwise: closer than that, moving is a phone call", async () => {
    const c = await company();
    const v = await visit(c, soon(), [c.anna]);
    expect((await times(v.token)).error).toBe("This visit is less than 48 hours away, so it can't be moved here. Call us and we'll help.");
    await setNotice(c, 24);
    expect((await times(v.token)).error).toBeUndefined();
    await setNotice(c, 72);
    expect((await times(v.token)).error).toMatch(/less than 72 hours away/);
  });

  it("decides whether a cancel happens at once or asks the office", async () => {
    const c = await company();
    const first = await visit(c, soon(), [c.anna]);
    // 30 hours out, 48 hours' notice: a request. The visit stays booked.
    expect(await as(null, () => acts.visitCancelAction({}, form({ token: first.token, reason: "" }))), api.log()).toEqual({ ok: true });
    expect((await row(first.id)).status).toBe("confirmed");
    expect(await api.sql("select status, auto_applied from public.client_job_requests where booking_id = $1", [first.id])).toEqual([{ status: "open", auto_applied: false }]);

    // The company allows it up to a day before: cancelled at once.
    await setNotice(c, 24);
    const second = await visit(c, soon(), [c.bea]);
    expect(await as(null, () => acts.visitCancelAction({}, form({ token: second.token, reason: "" })))).toEqual({ ok: true });
    expect((await row(second.id)).status).toBe("cancelled");
  });

  it("a company with no booking page keeps 48 hours", async () => {
    const c = await company("instant", { page: false });
    const near = await visit(c, soon(), [c.anna]);
    await as(null, () => acts.visitCancelAction({}, form({ token: near.token, reason: "" })));
    expect((await row(near.id)).status).toBe("confirmed");
    const far = await visit(c, iso(D, "10:00"), [c.bea]);
    await as(null, () => acts.visitCancelAction({}, form({ token: far.token, reason: "" })));
    expect((await row(far.id)).status).toBe("cancelled");
  });

  it("is saved with the hours, by owners and admins, as a whole number of hours", async () => {
    const c = await company();
    const fields: Record<string, string> = { min_notice_hours: "24", max_days_ahead: "60", gap_minutes: "30", slot_step_minutes: "60", change_notice_hours: "12" };
    for (const d of [1, 2, 3, 4, 5]) Object.assign(fields, { [`open_${d}`]: "on", [`start_${d}`]: "09:00", [`end_${d}`]: "17:00" });
    const notice = async () => (await api.sql<{ n: number; mode: string }>("select change_notice_hours as n, time_booking as mode from public.booking_pages where organization_id = $1", [c.org]))[0];
    expect((await as(c.manager, () => settings.saveOpenTimeRulesAction({}, form(fields)))).error).toMatch(/Only owners and admins/);
    expect((await as(c.owner, () => settings.saveOpenTimeRulesAction({}, form(fields)))).error, api.log()).toBeUndefined();
    // Saved, and the switch the form didn't mention is left as it was.
    expect(await notice()).toEqual({ n: 12, mode: "instant" });
    for (const bad of ["soon", "-1", "1.5", "900"]) {
      expect((await as(c.owner, () => settings.saveOpenTimeRulesAction({}, form({ ...fields, change_notice_hours: bad })))).error, bad).toBe(
        "Changes and cancellations: type a whole number of hours, up to 720.",
      );
    }
    expect((await notice()).n).toBe(12);
    // A form without the field (an older tab) leaves it alone.
    const { change_notice_hours: _gone, ...older } = fields;
    await as(c.owner, () => settings.saveOpenTimeRulesAction({}, form(older)));
    expect((await notice()).n).toBe(12);
  });
});
