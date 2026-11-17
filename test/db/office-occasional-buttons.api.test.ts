/**
 * The office's occasional buttons, run as the person who presses them
 * against a real database behind the real PostgREST. Outbound email is
 * caught.
 *
 *   tasks                       11 in the 90 days to 2026-11-16
 *   pass a client's note on     to the crew, from a booking's page
 *   a cleaner's "take me off"   resolved from the scheduling board
 *   saved scheduler views
 *   hold auto-send, resend      on an invoice
 *   bulk void                   from the invoice list
 *
 * Two used to say something that wasn't true: "held" for an invoice already
 * sent, and a bulk void of 400 failed outright because every id went in one
 * request address, which production refuses past about 375.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string };
const outbox = vi.hoisted(() => ({ email: [] as Sent[] }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: async (a: Sent) => {
    outbox.email.push({ to: a.to, subject: a.subject });
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push({ to: a.to, subject: a.subject });
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push({ to: a.to, subject: a.subject });
    return { ok: true, id: "test-message" };
  },
  // Sending is caught above, so the app may as well think it is set up.
  isEmailConfigured: () => true,
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
  outbox.email.length = 0;
});

async function as<T>(who: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await press();
  } catch (err) {
    const m = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (m) return { redirected: m[1] };
    throw err;
  } finally {
    await settle();
  }
}

type Company = { org: string; client: string; owner: Member; manager: Member; anna: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Office Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  const client = await addClient(api.sql, org, "Hilda Daubner");
  await api.sql("update public.clients set email = 'hilda@example.test' where id = $1", [client]);
  return {
    org,
    client,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("tasks", { timeout: 120_000 }, () => {
  it("made, done (a weekly one comes back a week later), reopened and deleted; a cleaner can't make one", async () => {
    const { createTaskAction, completeTaskAction, reopenTaskAction, deleteTaskAction } = await import("@/app/app/tasks/actions");
    const c = await company();
    const due = new Date(Date.now() + 2 * 86_400_000);
    due.setUTCSeconds(0, 0);
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };

    const made = await as(c.owner, () =>
      createTaskAction({}, form({ title: "Order more microfibre cloths", notes: "", assigned_to: c.manager.membershipId, due_at: due.toISOString(), recurrence: "weekly" })),
    );
    expect((made as { errors?: unknown }).errors, JSON.stringify(made)).toBeUndefined();
    const [task] = await api.sql<{ id: string; due_at: string; recurrence: string | null }>(
      "select id, due_at::text, recurrence from public.tasks where organization_id = $1",
      [c.org],
    );
    expect(task, api.log()).toBeDefined();
    expect(task.recurrence).toBe("weekly");

    expect(await as(c.owner, () => completeTaskAction(task.id, {}, new FormData()))).toEqual({});
    const rows = await api.sql<{ id: string; done: boolean; due_at: string }>(
      "select id, completed_at is not null as done, due_at::text from public.tasks where organization_id = $1 order by created_at",
      [c.org],
    );
    expect(rows.find((r) => r.id === task.id)?.done).toBe(true);
    if (task.recurrence === "weekly") {
      const next = rows.find((r) => r.id !== task.id);
      expect(next, "the weekly task comes back").toBeDefined();
      expect(new Date(next!.due_at).getTime() - new Date(task.due_at).getTime()).toBe(7 * 86_400_000);
      expect(next!.done).toBe(false);
    }

    expect(await as(c.owner, () => reopenTaskAction(task.id, {}, new FormData()))).toEqual({});
    expect((await api.sql<{ done: boolean }>("select completed_at is not null as done from public.tasks where id = $1", [task.id]))[0].done).toBe(false);
    expect(await as(c.owner, () => deleteTaskAction(task.id, {}, new FormData()))).toEqual({ redirected: "/app/tasks" });
    expect(await api.sql("select 1 from public.tasks where id = $1", [task.id])).toHaveLength(0);

    const byCleaner = (await as(c.anna, () => createTaskAction({}, form({ title: "Anna's task", notes: "" })))) as { errors?: Record<string, string> };
    expect(byCleaner.errors?._form).toBeTruthy();
  });
});

describe.skipIf(!hasPostgrest)("pass a client's note on to the crew", { timeout: 120_000 }, () => {
  it("records it on the visit and tells everyone on it; an empty note or a card number is refused on the page", async () => {
    const { relayVisitNoteAction } = await import("@/app/app/bookings/actions");
    const c = await company();
    const bea = await addMember(api.sql, c.org, "employee", "Bea");
    const [job] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, now() + interval '2 days', 180, 'standard', 'confirmed', $3) returning id`,
      [c.org, c.client, c.anna.membershipId],
    );
    for (const m of [c.anna, bea]) {
      await api.sql("insert into public.booking_assignees (organization_id, booking_id, membership_id) values ($1, $2, $3)", [c.org, job.id, m.membershipId]);
    }
    const form = (body: string) => {
      const f = new FormData();
      f.set("booking_id", job.id);
      f.set("body", body);
      return f;
    };

    await as(c.manager, () => relayVisitNoteAction(form("Please skip the basement this time, the dog is down there.")));
    const [note] = await api.sql<{ kind: string; body: string; status: string }>(
      "select kind, body, status from public.client_job_requests where booking_id = $1",
      [job.id],
    );
    expect(note, api.log()).toEqual({ kind: "job_note", body: "Please skip the basement this time, the dog is down there.", status: "resolved" });
    const told = await api.sql<{ recipient_membership_id: string }>(
      "select recipient_membership_id from public.notifications where organization_id = $1 and title like 'Note from%'",
      [c.org],
    );
    expect(new Set(told.map((t) => t.recipient_membership_id))).toEqual(new Set([c.anna.membershipId, bea.membershipId]));

    const empty = (await as(c.manager, () => relayVisitNoteAction(form("   ")))) as { redirected: string };
    expect(decodeURIComponent(empty.redirected)).toContain("note_error=Write the note first.");
    const card = (await as(c.manager, () => relayVisitNoteAction(form("Card 4111 1111 1111 1111 exp 12/28")))) as { redirected: string };
    expect(card.redirected).toContain("note_error=");
    expect(await api.sql("select 1 from public.client_job_requests where booking_id = $1", [job.id])).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("a cleaner's request to come off a client, and saved board views", { timeout: 120_000 }, () => {
  it("the office resolves the request; saves, renames and deletes a view; a cleaner can do neither", async () => {
    const { resolveShiftRequestAction } = await import("@/app/app/scheduling/actions");
    const { saveSchedulerViewAction, deleteSchedulerViewAction } = await import("@/app/app/scheduling/views-actions");
    const c = await company();
    const [job] = await api.sql<{ id: string }>(
      `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, assigned_to)
       values ($1, $2, now() + interval '3 days', 180, 'standard', 'confirmed', $3) returning id`,
      [c.org, c.client, c.anna.membershipId],
    );
    const [req] = await api.sql<{ id: string }>(
      `insert into public.shift_change_requests (organization_id, membership_id, booking_id, reason, status)
       values ($1, $2, $3, 'Moving across town', 'open') returning id`,
      [c.org, c.anna.membershipId, job.id],
    );

    expect(await as(c.anna, () => resolveShiftRequestAction(req.id))).toEqual({ ok: false, error: "Not allowed." });
    expect(await as(c.manager, () => resolveShiftRequestAction(req.id)), api.log()).toEqual({ ok: true });
    expect((await api.sql<{ status: string }>("select status from public.shift_change_requests where id = $1", [req.id]))[0].status).not.toBe("open");

    const saved = (await as(c.manager, () => saveSchedulerViewAction({ name: "Olha's week", filters: { members: [c.anna.membershipId] } }))) as {
      ok?: boolean;
      view?: { id: string; name: string };
      error?: string;
    };
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, view: { name: "Olha's week" } });
    const renamed = (await as(c.owner, () => saveSchedulerViewAction({ id: saved.view!.id, name: "Anna's week", filters: {} }))) as { view?: { name: string } };
    expect(renamed.view?.name).toBe("Anna's week");
    expect(await as(c.anna, () => saveSchedulerViewAction({ name: "Mine", filters: {} }))).toEqual({
      error: "Only owners, admins, or managers can save shared views.",
    });
    expect(await as(c.manager, () => deleteSchedulerViewAction(saved.view!.id))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.scheduler_views where id = $1", [saved.view!.id])).toHaveLength(0);
  });
});

describe.skipIf(!hasPostgrest)("an invoice: hold its auto-send, resend it, void a page of them", { timeout: 180_000 }, () => {
  async function invoice(c: Company, fields: { status?: string; auto?: string | null; number?: string } = {}): Promise<string> {
    const [i] = await api.sql<{ id: string }>(
      `insert into public.invoices (organization_id, client_id, status, amount_cents, number, auto_send_state, auto_send_at, sent_at, public_token)
       values ($1, $2, $3::public.invoice_status, 15000, $4, $5, case when $5 = 'scheduled' then now() + interval '1 hour' end,
               case when $3 <> 'draft' then now() end, md5(random()::text)) returning id`,
      [c.org, c.client, fields.status ?? "draft", fields.number ?? null, fields.auto ?? null],
    );
    return i.id;
  }
  const form = (id: string) => {
    const f = new FormData();
    f.set("id", id);
    return f;
  };

  it("hold stops a scheduled send; on one already sent it says so instead of 'held'", async () => {
    const { holdInvoiceAutoSendAction } = await import("@/app/app/invoices/actions");
    const c = await company();
    const scheduled = await invoice(c, { auto: "scheduled" });
    const gone = await invoice(c, { status: "sent", auto: "sent" });

    expect(await as(c.owner, () => holdInvoiceAutoSendAction({}, form(scheduled))), api.log()).toEqual({ ok: true });
    expect((await api.sql<{ s: string }>("select auto_send_state as s from public.invoices where id = $1", [scheduled]))[0].s).toBe("held");

    const late = (await as(c.owner, () => holdInvoiceAutoSendAction({}, form(gone)))) as { error?: string };
    expect(late.error).toContain("isn't waiting to send");
    expect(
      await api.sql("select 1 from public.audit_log where entity_id = $1 and after->>'auto_send_state' = 'held'", [gone]),
    ).toHaveLength(0);
    expect(await as(c.manager, () => holdInvoiceAutoSendAction({}, form(scheduled)))).toEqual({ error: "Only owners and admins can change invoices." });
  });

  it("resend emails the client again and leaves the invoice as it was; a cleaner can't", async () => {
    const { resendInvoiceEmailAction } = await import("@/app/app/invoices/actions");
    const c = await company();
    const sent = await invoice(c, { status: "sent", number: "INV-2026-0401" });
    const [before] = await api.sql<{ sent_at: string }>("select sent_at::text from public.invoices where id = $1", [sent]);

    const res = (await as(c.owner, () => resendInvoiceEmailAction({}, form(sent)))) as { ok?: boolean; error?: string };
    expect(res, JSON.stringify(res) + api.log().slice(-400)).toMatchObject({ ok: true });
    expect(outbox.email.map((e) => e.to)).toContain("hilda@example.test");
    const [after] = await api.sql<{ status: string; sent_at: string }>("select status::text as status, sent_at::text from public.invoices where id = $1", [sent]);
    expect(after).toEqual({ status: "sent", sent_at: before.sent_at });

    outbox.email.length = 0;
    const cleaner = (await as(c.anna, () => resendInvoiceEmailAction({}, form(sent)))) as { ok?: boolean; error?: string };
    expect(cleaner.ok).not.toBe(true);
    expect(outbox.email).toHaveLength(0);
  });

  it("voids 400 drafts in one go and names the one with money on it", async () => {
    const { bulkVoidInvoicesAction } = await import("@/app/app/invoices/actions");
    const c = await company();
    await api.sql(
      `insert into public.invoices (organization_id, client_id, status, amount_cents)
       select $1, $2, 'draft', 1000 from generate_series(1, 400)`,
      [c.org, c.client],
    );
    const paidOne = await invoice(c, { status: "sent", number: "INV-2026-0402" });
    await api.sql("insert into public.invoice_payments (organization_id, invoice_id, amount_cents, method) values ($1, $2, 5000, 'cash')", [c.org, paidOne]);
    const ids = (await api.sql<{ id: string }>("select id from public.invoices where organization_id = $1", [c.org])).map((r) => r.id);

    const res = await as(c.owner, () => bulkVoidInvoicesAction(ids));
    expect(res, api.log().slice(-600)).toEqual({ ok: true, voided: 400, hasPayments: ["INV-2026-0402"] });
    const [left] = await api.sql<{ live: number }>(
      "select count(*)::int as live from public.invoices where organization_id = $1 and status <> 'void'",
      [c.org],
    );
    expect(left.live).toBe(1);
  });
});
