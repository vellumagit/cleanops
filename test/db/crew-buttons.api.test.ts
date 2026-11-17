/**
 * The crew's less frequent buttons, run as the cleaner who presses them
 * against a real database behind the real PostgREST (and the stack's
 * stand-in file storage, which keeps files but does not enforce storage
 * policies). Svit's use, 90 days to 2026-11-16:
 *
 *   job photos        46 added
 *   days off / hours  8 one-off changes (and 20 weekly ones, tested elsewhere)
 *   time off          5 requests
 *
 * A delete the database's rules refuse removes nothing and reports no
 * error. Photos and days off used to answer "done" to it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
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
  sendEmail: async () => true,
  sendOrgEmail: async () => true,
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

async function as<T>(who: Member, press: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await press();
  } finally {
    await settle();
  }
}

const DAY = 86_400_000;
const ymd = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type Company = { org: string; owner: Member; manager: Member; anna: Member; bea: Member; cleo: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Crew Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
    cleo: await addMember(api.sql, org, "employee", "Cleo"),
  };
}

const told = (org: string, like: string) =>
  api.sql<{ recipient_membership_id: string }>(
    "select recipient_membership_id from public.notifications where organization_id = $1 and (title ilike $2 or body ilike $2)",
    [org, like],
  );

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("job photos", { timeout: 120_000 }, () => {
  /** A real JPEG header, so the byte check sees a photo. */
  const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])], "kitchen.jpg", { type: "image/jpeg" });
  const form = (fields: Record<string, string | File>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("anyone on the crew adds one; a file that isn't a photo, or someone not on the job, is refused", async () => {
    const { uploadJobPhotoAction } = await import("@/app/field/jobs/[id]/photo-actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Margaret Ann MacLeod");
    const [job] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, now() - interval '1 hour', 240, 'standard', 'confirmed', $3) returning id`,
      [c.org, client, c.anna.membershipId],
    );
    for (const m of [c.anna, c.bea]) {
      await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')", [
        c.org,
        job.id,
        m.membershipId,
      ]);
    }

    // Bea is the second cleaner on the job, not the first.
    const added = await as(c.bea, () => uploadJobPhotoAction(form({ booking_id: job.id, kind: "after", photo: jpeg() })));
    expect(added, api.log()).toMatchObject({ ok: true });
    const photoId = (added as { photo_id: string }).photo_id;
    const [row] = await api.sql<{ storage_path: string; kind: string; uploaded_by: string; mime_type: string }>(
      "select storage_path, kind, uploaded_by, mime_type from public.job_photos where id = $1",
      [photoId],
    );
    expect(row).toMatchObject({ kind: "after", uploaded_by: c.bea.membershipId, mime_type: "image/jpeg" });
    expect(api.storage.has(`job-photos/${row.storage_path}`)).toBe(true);
    expect((added as { signed_url: string }).signed_url).not.toBe("");

    const notAPhoto = new File([new TextEncoder().encode("MZ this is a program, not a picture")], "x.jpg", { type: "image/jpeg" });
    expect(await as(c.bea, () => uploadJobPhotoAction(form({ booking_id: job.id, photo: notAPhoto })))).toEqual({
      ok: false,
      error: "Only JPG, PNG, HEIC, and WebP photos can be added.",
    });
    expect(await as(c.cleo, () => uploadJobPhotoAction(form({ booking_id: job.id, photo: jpeg() })))).toEqual({
      ok: false,
      error: "Only the assigned cleaner or a manager can add photos.",
    });
    expect(await api.sql("select 1 from public.job_photos where booking_id = $1", [job.id])).toHaveLength(1);
  });

  it("the person who added it, or a manager, deletes it; a teammate is told no and the photo stays", async () => {
    const { uploadJobPhotoAction, deleteJobPhotoAction } = await import("@/app/field/jobs/[id]/photo-actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Patricia Poohkay");
    const [job] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, now() - interval '1 hour', 240, 'standard', 'confirmed', $3) returning id`,
      [c.org, client, c.anna.membershipId],
    );
    for (const m of [c.anna, c.bea]) {
      await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, 'accepted')", [
        c.org,
        job.id,
        m.membershipId,
      ]);
    }
    const first = (await as(c.bea, () => uploadJobPhotoAction(form({ booking_id: job.id, kind: "before", photo: jpeg() })))) as { photo_id: string };
    const second = (await as(c.bea, () => uploadJobPhotoAction(form({ booking_id: job.id, kind: "after", photo: jpeg() })))) as { photo_id: string };
    const path = async (id: string) =>
      (await api.sql<{ p: string }>("select storage_path as p from public.job_photos where id = $1", [id]))[0]?.p;
    const firstPath = await path(first.photo_id);

    const byTeammate = await as(c.anna, () => deleteJobPhotoAction(form({ photo_id: first.photo_id, booking_id: job.id })));
    expect(byTeammate).toEqual({ ok: false, error: "Only the person who added this photo, or a manager, can delete it." });
    expect(await path(first.photo_id)).toBe(firstPath);
    expect(api.storage.has(`job-photos/${firstPath}`), "the file is still there for the row that points at it").toBe(true);

    expect(await as(c.bea, () => deleteJobPhotoAction(form({ photo_id: first.photo_id, booking_id: job.id })))).toEqual({ ok: true });
    expect(await path(first.photo_id)).toBeUndefined();
    expect(api.storage.has(`job-photos/${firstPath}`)).toBe(false);

    expect(await as(c.manager, () => deleteJobPhotoAction(form({ photo_id: second.photo_id, booking_id: job.id })))).toEqual({ ok: true });
    expect(await path(second.photo_id)).toBeUndefined();
  });
});

describe.skipIf(!hasPostgrest)("a day off, or different hours, on one date", { timeout: 120_000 }, () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("a cleaner marks her own day off and the office is told once; hours that end before they start are refused", async () => {
    const { saveAvailabilityOverrideAction } = await import("@/app/field/availability/actions");
    const c = await company();
    const day = ymd(10);

    expect(await as(c.anna, () => saveAvailabilityOverrideAction(form({ date: day, kind: "off", reason: "Dentist" }))), api.log()).toEqual({ ok: true });
    expect(await as(c.anna, () => saveAvailabilityOverrideAction(form({ date: day, kind: "off", reason: "Dentist, 2pm" })))).toEqual({ ok: true });
    const rows = await api.sql<{ kind: string; reason: string }>(
      "select kind, reason from public.availability_overrides where membership_id = $1 and date = $2",
      [c.anna.membershipId, day],
    );
    expect(rows).toEqual([{ kind: "off", reason: "Dentist, 2pm" }]);
    const notices = await told(c.org, "%Anna%");
    expect(new Set(notices.map((n) => n.recipient_membership_id))).toEqual(new Set([c.owner.membershipId, c.manager.membershipId]));
    expect(notices).toHaveLength(2);

    const backwards = await as(c.anna, () => saveAvailabilityOverrideAction(form({ date: ymd(11), kind: "custom", start_time: "15:00", end_time: "09:00" })));
    expect((backwards as { ok: boolean }).ok).toBe(false);
  });

  it("only she or a manager changes or removes her day; a teammate is told no and the day stays", async () => {
    const { saveAvailabilityOverrideAction, deleteAvailabilityOverrideAction } = await import("@/app/field/availability/actions");
    const c = await company();
    const day = ymd(12);
    await as(c.anna, () => saveAvailabilityOverrideAction(form({ date: day, kind: "off" })));
    const [row] = await api.sql<{ id: string }>("select id from public.availability_overrides where membership_id = $1", [c.anna.membershipId]);

    expect(await as(c.bea, () => saveAvailabilityOverrideAction(form({ date: day, kind: "custom", start_time: "09:00", end_time: "12:00", membership_id: c.anna.membershipId })))).toEqual({
      ok: false,
      error: "Only managers can override someone else's availability.",
    });
    expect(await as(c.bea, () => deleteAvailabilityOverrideAction(form({ id: row.id })))).toEqual({
      ok: false,
      error: "Only the person whose day it is, or a manager, can remove it.",
    });
    expect(await api.sql("select 1 from public.availability_overrides where id = $1", [row.id])).toHaveLength(1);

    expect(await as(c.anna, () => deleteAvailabilityOverrideAction(form({ id: row.id })))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.availability_overrides where id = $1", [row.id])).toHaveLength(0);

    expect(await as(c.manager, () => saveAvailabilityOverrideAction(form({ date: day, kind: "custom", start_time: "09:00", end_time: "12:00", membership_id: c.anna.membershipId })))).toEqual({ ok: true });
    const [byManager] = await api.sql<{ kind: string; start_time: string; end_time: string }>(
      "select kind, start_time::text, end_time::text from public.availability_overrides where membership_id = $1 and date = $2",
      [c.anna.membershipId, day],
    );
    expect(byManager).toMatchObject({ kind: "custom" });
    expect(byManager.start_time.startsWith("09:00")).toBe(true);
  });
});

/**
 * Every other button that writes AS the cleaner (not through the server's own
 * access), pressed once by a cleaner. The September permission change that
 * cut off time-off requests (migration 20260913030000) assumed no such path
 * existed for them; this is the check that one doesn't silently fail again.
 */
describe.skipIf(!hasPostgrest)("the cleaner's own writes all land", { timeout: 120_000 }, () => {
  it("GPS consent, her profile, a training step and a chat message, each pressed as a cleaner", async () => {
    const { acceptGpsConsentAction } = await import("@/app/field/jobs/actions");
    const { updateProfileAction } = await import("@/app/field/profile/actions");
    const { toggleStepAction } = await import("@/app/field/training/actions");
    const { createDmThreadAction, sendChatMessageAction, markThreadReadAction } = await import("@/lib/chat-actions");
    const c = await company();

    await as(c.anna, () => acceptGpsConsentAction());
    const [gps] = await api.sql<{ ok: boolean }>("select gps_consent_accepted_at is not null as ok from public.memberships where id = $1", [c.anna.membershipId]);
    expect(gps.ok, `GPS consent didn't save: ${api.log().slice(-600)}`).toBe(true);

    const profile = new FormData();
    profile.set("full_name", "Anna Vasylieva");
    profile.set("phone", "+15875550123");
    const saved = (await as(c.anna, () => updateProfileAction({}, profile))) as { errors?: Record<string, string> };
    expect(saved.errors, JSON.stringify(saved)).toBeUndefined();
    const [p] = await api.sql<{ full_name: string; phone: string }>(
      "select full_name, phone from public.profiles where id = $1",
      [c.anna.userId],
    );
    expect(p).toEqual({ full_name: "Anna Vasylieva", phone: "+15875550123" });

    const [mod] = await api.sql<{ id: string }>("insert into public.training_modules (organization_id, title) values ($1, 'Kitchens') returning id", [c.org]);
    const [step] = await api.sql<{ id: string }>(
      "insert into public.training_steps (organization_id, module_id, ord, body) values ($1, $2, 0, 'Degrease the hood') returning id",
      [c.org, mod.id],
    );
    await api.sql("insert into public.training_assignments (organization_id, module_id, employee_id) values ($1, $2, $3)", [c.org, mod.id, c.anna.membershipId]);
    const tick = new FormData();
    tick.set("module_id", mod.id);
    tick.set("step_id", step.id);
    tick.set("desired", "complete");
    const ticked = await as(c.anna, () => toggleStepAction(tick));
    expect(ticked, JSON.stringify(ticked)).toMatchObject({ ok: true });
    const [assignment] = await api.sql<{ steps: string[] }>(
      "select completed_step_ids::text[] as steps from public.training_assignments where module_id = $1 and employee_id = $2",
      [mod.id, c.anna.membershipId],
    );
    expect(assignment.steps).toEqual([step.id]);

    const thread = await as(c.anna, () => createDmThreadAction(c.bea.membershipId));
    expect(thread, JSON.stringify(thread)).toMatchObject({ ok: true });
    const threadId = (thread as { thread_id: string }).thread_id;
    const sent = await as(c.anna, () => sendChatMessageAction(threadId, "I'm running ten minutes late"));
    expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true });
    expect(await api.sql("select 1 from public.chat_messages where thread_id = $1 and body = $2", [threadId, "I'm running ten minutes late"])).toHaveLength(1);
    await as(c.bea, () => markThreadReadAction(threadId));
  });
});

describe.skipIf(!hasPostgrest)("time off", { timeout: 120_000 }, () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("a cleaner asks, the office is told, a manager approves; a cleaner can't approve, and dates backwards are refused", async () => {
    const { submitSelfPtoRequestAction, updatePtoStatusAction } = await import("@/app/app/timesheets/actions");
    const c = await company();

    const asked = await as(c.anna, () => submitSelfPtoRequestAction(form({ start_date: ymd(20), end_date: ymd(21), hours: "16", reason: "Family visit" })));
    expect(asked, JSON.stringify(asked)).toEqual({ ok: true });
    const [req] = await api.sql<{ id: string; status: string; hours: number }>(
      "select id, status, hours::float as hours from public.pto_requests where employee_id = $1",
      [c.anna.membershipId],
    );
    expect(req).toMatchObject({ status: "pending", hours: 16 });
    expect((await told(c.org, "%Anna%")).length).toBeGreaterThanOrEqual(2);

    expect(await as(c.anna, () => submitSelfPtoRequestAction(form({ start_date: ymd(25), end_date: ymd(24), hours: "8" })))).toEqual({
      ok: false,
      error: "End date must be on or after start date.",
    });

    expect(await as(c.bea, () => updatePtoStatusAction(form({ id: req.id, status: "approved" })))).toEqual({ ok: false, error: "Not authorized." });
    expect(await as(c.manager, () => updatePtoStatusAction(form({ id: req.id, status: "approved" })))).toMatchObject({ ok: true });
    const [after] = await api.sql<{ status: string; reviewed_by: string }>("select status, reviewed_by from public.pto_requests where id = $1", [req.id]);
    expect(after).toEqual({ status: "approved", reviewed_by: c.manager.membershipId });
  });

  it("time off a payroll run already covers can't be approved into a run that will never pay it", async () => {
    const { submitSelfPtoRequestAction, updatePtoStatusAction } = await import("@/app/app/timesheets/actions");
    const c = await company();
    await as(c.anna, () => submitSelfPtoRequestAction(form({ start_date: ymd(-10), end_date: ymd(-9), hours: "8" })));
    const [req] = await api.sql<{ id: string }>("select id from public.pto_requests where employee_id = $1", [c.anna.membershipId]);
    await api.sql(
      "insert into public.payroll_runs (organization_id, period_start, period_end, status) values ($1, $2, $3, 'draft')",
      [c.org, ymd(-14), ymd(-1)],
    );
    const res = (await as(c.manager, () => updatePtoStatusAction(form({ id: req.id, status: "approved" })))) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("A payroll run already covers");
    expect((await api.sql<{ status: string }>("select status from public.pto_requests where id = $1", [req.id]))[0].status).toBe("pending");
  });
});
