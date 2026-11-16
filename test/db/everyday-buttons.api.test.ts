/**
 * Buttons Svit's people pressed in the month to 2026-11-16 that no test had
 * named, run as the person who presses them: the app's own server actions,
 * signed in from a session cookie, through PostgREST and row-level security,
 * against a real database. Only the framework is stood in for (cookies,
 * revalidatePath, redirect, after) and outbound email.
 *
 *   accept a shift      the crew's "tap to confirm", about 99 prompts a week
 *   new client          15 that month
 *   client property     saved, and its upcoming visits follow a new address
 *   archive a client    cancels what is still to come, never what is billed
 *   snooze              a "needs you" item, from the office dashboard
 *   edit a service      8 that month
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

/** Signed in as `who`, press the button; wait for what it deferred. A redirect is how a form says "saved". */
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

const DAY = 86_400_000;
const at = (days: number, hourUtc = 16) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
};

type Company = { org: string; owner: Member; manager: Member; anna: Member; bea: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Everyday Co");
  await api.sql("update public.organizations set timezone = 'America/Regina', automations_enabled = true where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    manager: await addMember(api.sql, org, "manager", "Office"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
    bea: await addMember(api.sql, org, "employee", "Bea"),
  };
}

async function visit(
  org: string,
  client: string,
  scheduledAt: string,
  opts: { crew?: Array<{ m: Member; status?: string }>; series?: string | null; status?: string; address?: string | null; property?: string | null } = {},
): Promise<string> {
  const [b] = await api.sql<{ id: string }>(
    `insert into public.bookings (organization_id, client_id, scheduled_at, duration_minutes, service_type, status, series_id, address, property_id, total_cents)
     values ($1, $2, $3::timestamptz, 120, 'standard', $4::public.booking_status, $5, $6, $7, 15000) returning id`,
    [org, client, scheduledAt, opts.status ?? "confirmed", opts.series ?? null, opts.address ?? null, opts.property ?? null],
  );
  for (const c of opts.crew ?? []) {
    await api.sql(
      "insert into public.booking_assignees (organization_id, booking_id, membership_id, acceptance_status) values ($1, $2, $3, $4)",
      [org, b.id, c.m.membershipId, c.status ?? "pending"],
    );
  }
  return b.id;
}

async function series(org: string, client: string): Promise<string> {
  const [s] = await api.sql<{ id: string }>(
    `insert into public.booking_series (organization_id, client_id, pattern, start_time, starts_at, generate_ahead, duration_minutes, service_type, total_cents, active)
     values ($1, $2, 'weekly', '10:00', current_date, 4, 120, 'standard', 15000, true) returning id`,
    [org, client],
  );
  return s.id;
}

const acceptance = async (bookingId: string, m: Member) =>
  (
    await api.sql<{ s: string }>(
      "select acceptance_status::text as s from public.booking_assignees where booking_id = $1 and membership_id = $2",
      [bookingId, m.membershipId],
    )
  )[0]?.s;

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("accept a shift: the crew's 'tap to confirm'", { timeout: 120_000 }, () => {
  it("confirms her own place on this visit and every later one in the series, nobody else's, nothing past", async () => {
    const { acceptShiftAction } = await import("@/app/field/jobs/actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Margaret Ann MacLeod");
    const s = await series(c.org, client);
    const crew = [{ m: c.anna }, { m: c.bea }];
    const past = await visit(c.org, client, at(-7), { series: s, crew, status: "completed" });
    const tapped = await visit(c.org, client, at(2), { series: s, crew });
    const later = [await visit(c.org, client, at(9), { series: s, crew }), await visit(c.org, client, at(16), { series: s, crew })];
    const otherClient = await addClient(api.sql, c.org, "Patricia Poohkay");
    const elsewhere = await visit(c.org, otherClient, at(3), { crew: [{ m: c.anna }] });

    const res = await as(c.anna, () => acceptShiftAction(tapped));
    expect(res, api.log()).toEqual({ ok: true });

    expect(await acceptance(tapped, c.anna)).toBe("accepted");
    for (const id of later) expect(await acceptance(id, c.anna)).toBe("accepted");
    // Bea answers for herself; the past is the past; another client is another question.
    for (const id of [tapped, ...later]) expect(await acceptance(id, c.bea)).toBe("pending");
    expect(await acceptance(past, c.anna)).toBe("pending");
    expect(await acceptance(elsewhere, c.anna)).toBe("pending");
  });
});

describe.skipIf(!hasPostgrest)("new client", { timeout: 120_000 }, () => {
  it("saves what the form says and lands back on the list; a blank name or a bad email is refused in words", async () => {
    const { createClientAction } = await import("@/app/app/clients/actions");
    const c = await company();
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };

    const saved = await as(c.owner, () =>
      createClientAction({}, form({ name: "Liudmyla Blazhko", email: "liudmyla@example.test", phone: "+15875550101", address: "7723 181 Ave NW, Edmonton" })),
    );
    expect(saved, api.log()).toEqual({ redirected: "/app/clients" });
    const [row] = await api.sql<{ name: string; email: string; phone: string; address: string; contact_preference: string }>(
      "select name, email, phone, address, contact_preference from public.clients where organization_id = $1",
      [c.org],
    );
    expect(row).toEqual({
      name: "Liudmyla Blazhko",
      email: "liudmyla@example.test",
      phone: "+15875550101",
      address: "7723 181 Ave NW, Edmonton",
      contact_preference: "inherit",
    });
    expect(
      await api.sql("select 1 from public.audit_log where organization_id = $1 and entity = 'client' and action = 'create'", [c.org]),
    ).toHaveLength(1);

    const blank = (await as(c.owner, () => createClientAction({}, form({ name: "  " })))) as { errors?: Record<string, string> };
    expect(blank.errors?.name).toBeTruthy();
    const badEmail = (await as(c.owner, () => createClientAction({}, form({ name: "Ken Hicks", email: "not-an-email" })))) as {
      errors?: Record<string, string>;
    };
    expect(badEmail.errors?.email).toBe("Enter a valid email");
    expect(await api.sql("select 1 from public.clients where organization_id = $1", [c.org])).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("client property", { timeout: 120_000 }, () => {
  it("a new property saves; changing its address moves its upcoming visits, not the ones typed elsewhere or finished", async () => {
    const { saveClientPropertyAction } = await import("@/app/app/clients/[id]/property-actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Liudmyla Blazhko");
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      f.set("client_id", client);
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };

    const created = (await as(c.owner, () =>
      saveClientPropertyAction({}, form({ label: "Bountiful Farmers' Market", address: "3696 97 Street NW, Edmonton" })),
    )) as { done?: boolean; errors?: unknown };
    expect(created, api.log()).toMatchObject({ done: true });
    const [prop] = await api.sql<{ id: string }>("select id from public.client_properties where client_id = $1", [client]);

    const upcoming = await visit(c.org, client, at(5), { property: prop.id, address: "3696 97 Street NW, Edmonton" });
    const typedElsewhere = await visit(c.org, client, at(6), { property: prop.id, address: "1 Other Road" });
    const finished = await visit(c.org, client, at(-3), { property: prop.id, address: "3696 97 Street NW, Edmonton", status: "completed" });

    const moved = (await as(c.owner, () =>
      saveClientPropertyAction(
        {},
        form({ property_id: prop.id, label: "Bountiful Farmers' Market", address: "3696 97 Street Northwest, Edmonton, AB" }),
      ),
    )) as { done?: boolean; notice?: string };
    expect(moved).toMatchObject({ done: true });
    expect(moved.notice).toContain("1 upcoming visit now uses the new address");
    expect(moved.notice).toContain("1 upcoming visit has a different address typed on it");
    const addr = async (id: string) =>
      (await api.sql<{ address: string }>("select address from public.bookings where id = $1", [id]))[0].address;
    expect(await addr(upcoming)).toBe("3696 97 Street Northwest, Edmonton, AB");
    expect(await addr(typedElsewhere)).toBe("1 Other Road");
    expect(await addr(finished)).toBe("3696 97 Street NW, Edmonton");

    // A cleaner can't.
    const refused = (await as(c.anna, () => saveClientPropertyAction({}, form({ label: "Cabin", address: "x" })))) as {
      errors?: Record<string, string>;
    };
    expect(refused.errors?._form).toBe("You don't have permission to do that.");
  });
});

describe.skipIf(!hasPostgrest)("archive a client", { timeout: 120_000 }, () => {
  it("cancels what is still to come and stops the series; keeps what is billed and what is done; once only; owners only", async () => {
    const { archiveClientAction, unarchiveClientAction } = await import("@/app/app/clients/actions");
    const c = await company();
    const client = await addClient(api.sql, c.org, "Nancy Ellestad");
    const s = await series(c.org, client);
    const coming = [await visit(c.org, client, at(3), { series: s, crew: [{ m: c.anna }] }), await visit(c.org, client, at(10), { series: s })];
    const done = await visit(c.org, client, at(-5), { status: "completed" });
    // A visit still to come that an invoice already bills (a deposit, say).
    const billedAhead = await visit(c.org, client, at(4));
    const [inv] = await api.sql<{ id: string }>(
      "insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents) values ($1, $2, $3, 'sent', 15000) returning id",
      [c.org, client, billedAhead],
    );
    await api.sql("update public.bookings set billing_invoice_id = $2 where id = $1", [billedAhead, inv.id]);
    const form = () => {
      const f = new FormData();
      f.set("id", client);
      return f;
    };

    expect(await as(c.manager, () => archiveClientAction(form()))).toEqual({
      ok: false,
      error: "Only owners and admins can archive clients.",
    });

    const res = await as(c.owner, () => archiveClientAction(form()));
    expect(res, api.log()).toEqual({ ok: true, cancelledBookings: 2, pausedSeries: 1 });
    const status = async (id: string) =>
      (await api.sql<{ s: string }>("select status::text as s from public.bookings where id = $1", [id]))[0].s;
    for (const id of coming) expect(await status(id)).toBe("cancelled");
    expect(await status(billedAhead)).toBe("confirmed");
    expect(await status(done)).toBe("completed");
    expect((await api.sql<{ active: boolean }>("select active from public.booking_series where id = $1", [s]))[0].active).toBe(false);

    expect(await as(c.owner, () => archiveClientAction(form()))).toEqual({ ok: false, error: "This client is already archived." });

    expect(await as(c.owner, () => unarchiveClientAction(form()))).toMatchObject({ ok: true });
    expect((await api.sql<{ a: boolean }>("select archived_at is null as a from public.clients where id = $1", [client]))[0].a).toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("snooze a 'needs you' item", { timeout: 120_000 }, () => {
  it("the office snoozes it, can snooze it again later, and a cleaner can't", async () => {
    const { snoozeItemAction } = await import("@/app/app/needs-you-actions");
    const c = await company();
    const key = "late_start:booking-1:member-1";
    const first = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const second = new Date(Date.now() + 26 * 3_600_000).toISOString();

    expect(await as(c.owner, () => snoozeItemAction(key, first)), api.log()).toEqual({ ok: true });
    expect(await as(c.manager, () => snoozeItemAction(key, second))).toEqual({ ok: true });
    const rows = await api.sql<{ until: string }>(
      "select snoozed_until::text as until from public.needs_you_state where organization_id = $1 and key = $2",
      [c.org, key],
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].until).toISOString()).toBe(second);

    const refused = (await as(c.anna, () => snoozeItemAction(key, first))) as { ok: boolean };
    expect(refused.ok).toBe(false);
  });
});

describe.skipIf(!hasPostgrest)("edit a service", { timeout: 120_000 }, () => {
  it("saves the new name, length and price; a name another service has is refused; a cleaner can't", async () => {
    const { updateServiceTypeAction } = await import("@/app/app/settings/services/actions");
    const c = await company();
    const [deep] = await api.sql<{ id: string }>(
      "insert into public.service_types (organization_id, name, category) values ($1, 'Deep clean', 'deep') returning id",
      [c.org],
    );
    await api.sql("insert into public.service_types (organization_id, name, category) values ($1, 'Move-out clean', 'move_out')", [c.org]);
    const form = (name: string) => {
      const f = new FormData();
      f.set("category", "deep");
      f.set("name", name);
      f.set("description", "Baseboards, inside the oven, inside the fridge.");
      f.set("default_duration_minutes", "300");
      f.set("default_price_cents", "450.00");
      f.set("color", "");
      f.set("sort_order", "");
      f.set("is_active", "on");
      return f;
    };

    expect(await as(c.owner, () => updateServiceTypeAction(deep.id, {}, form("Deep clean (full)"))), api.log()).toEqual({ ok: true });
    const [row] = await api.sql<{ name: string; default_duration_minutes: number; default_price_cents: number }>(
      "select name, default_duration_minutes, default_price_cents from public.service_types where id = $1",
      [deep.id],
    );
    expect(row).toEqual({ name: "Deep clean (full)", default_duration_minutes: 300, default_price_cents: 45000 });

    const clash = (await as(c.owner, () => updateServiceTypeAction(deep.id, {}, form("Move-out clean")))) as { errors?: Record<string, string> };
    expect(clash.errors?.name).toBe("A service with that name already exists.");

    // A cleaner is sent back to her own app, and nothing changes.
    expect(await as(c.anna, () => updateServiceTypeAction(deep.id, {}, form("Anna's clean")))).toEqual({ redirected: "/field" });
    expect((await api.sql<{ name: string }>("select name from public.service_types where id = $1", [deep.id]))[0].name).toBe(
      "Deep clean (full)",
    );
  });
});
