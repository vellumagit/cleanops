/**
 * Hiring and removing people, pressed as the office presses it, against a
 * real database behind the real PostgREST and the stand-in file storage.
 *
 *   applicants      move along the pipeline, notes, delete, hire
 *   interviews      start from a questionnaire, save answers, delete
 *   hiring library  questionnaires and procedures
 *   join            the invite link a new hire opens
 *   employees       their documents, delete, force remove, recovery link,
 *                   withdrawing an invitation
 *
 * The stack stands in for GoTrue's admin user lookups only. Three more calls
 * these buttons make are stood in here, inside this file: sign-up (a new hire
 * creating a login), deleting a login (force remove) and minting a recovery
 * link. Deleting a login really deletes the auth.users row, so whatever the
 * database cascades from it happens here as it would in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Sent = { to: string; subject: string; text?: string; html?: string };
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
  isEmailConfigured: () => true,
  sendEmail: async (a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmail: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return true;
  },
  sendOrgEmailDetailed: async (_o: string, a: Sent) => {
    outbox.email.push(a);
    return { ok: true };
  },
}));

let api: Api;
let restoreEnv: () => void;
let restoreFetch: () => void = () => {};
let applicants: typeof import("@/app/app/applicants/actions");
let interviews: typeof import("@/app/app/applicants/[id]/interview-actions");
let hiring: typeof import("@/app/app/hiring/actions");
let employees: typeof import("@/app/app/employees/actions");
let documents: typeof import("@/app/app/employees/[id]/document-actions");
let join: typeof import("@/app/join/[token]/actions");

/** What the GoTrue stand-in below was asked to do. */
const gotrue = { deleted: [] as string[], links: [] as string[], signups: [] as string[] };

/**
 * GoTrue calls the stack has no stand-in for, answered here. Anything else
 * goes to the real stack untouched.
 */
function standInGoTrue(a: Api): () => void {
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${a.url}/auth/v1/`)) {
      const path = url.slice(a.url.length).split("?")[0];
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
      const del = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
      if (del && method === "DELETE") {
        try {
          await a.sql("delete from auth.users where id = $1", [del[1]]);
        } catch (err) {
          return json(500, { code: 500, msg: `Database error deleting user: ${String(err)}` });
        }
        gotrue.deleted.push(del[1]);
        return json(200, { id: del[1] });
      }
      if (path === "/auth/v1/admin/generate_link" && method === "POST") {
        const [u] = await a.sql<{ id: string; email: string }>("select id, email from auth.users where lower(email) = lower($1)", [body.email]);
        if (!u) return json(404, { code: 404, msg: "User with this email not found" });
        gotrue.links.push(u.email);
        return json(200, {
          id: u.id,
          aud: "authenticated",
          role: "authenticated",
          email: u.email,
          action_link: "https://stand-in.example.com/verify",
          email_otp: "123456",
          hashed_token: "hashed-recovery-token",
          redirect_to: "",
          verification_type: "recovery",
        });
      }
      if (path === "/auth/v1/signup" && method === "POST") {
        const email = String(body.email ?? "").toLowerCase();
        const [exists] = await a.sql("select 1 from auth.users where lower(email) = $1", [email]);
        if (exists) return json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
        const [u] = await a.sql<{ id: string }>(
          "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
          [email, JSON.stringify(body.data ?? {})],
        );
        gotrue.signups.push(email);
        // Email confirmation on: a user and no session.
        return json(200, {
          id: u.id,
          aud: "authenticated",
          role: "authenticated",
          email,
          identities: [{ id: u.id, identity_id: u.id, provider: "email" }],
          user_metadata: body.data ?? {},
          app_metadata: {},
          created_at: new Date().toISOString(),
        });
      }
    }
    return real(input as RequestInfo, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  restoreFetch = standInGoTrue(api);
  applicants = await import("@/app/app/applicants/actions");
  interviews = await import("@/app/app/applicants/[id]/interview-actions");
  hiring = await import("@/app/app/hiring/actions");
  employees = await import("@/app/app/employees/actions");
  documents = await import("@/app/app/employees/[id]/document-actions");
  join = await import("@/app/join/[token]/actions");
}, 240_000);

afterAll(async () => {
  restoreFetch();
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  outbox.email.length = 0;
});

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member | null, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = m ? api.sessionCookies(m.userId) : [];
  try {
    return await press();
  } catch (err) {
    const r = /^redirected to (.*)$/.exec(err instanceof Error ? err.message : "");
    if (r) return { redirected: r[1] };
    throw err;
  } finally {
    await settle();
  }
}

const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

let seq = 0;
async function company() {
  const org = await addOrg(api.sql, "People Co");
  await api.sql("update public.organizations set timezone = 'America/Regina' where id = $1", [org]);
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Iryna"),
    olha: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

async function applicant(c: Co, over: Record<string, string> = {}) {
  const n = ++seq;
  const [row] = await api.sql<{ id: string }>(
    `insert into public.job_applicants (organization_id, name, email, phone, status, notes)
     values ($1, $2, $3, '+14035550100', $4, $5) returning id`,
    [c.org, over.name ?? `Applicant ${n}`, over.email ?? `applicant${n}@example.com`, over.status ?? "new", over.notes ?? null],
  );
  return row.id;
}
const applicantRow = async (id: string) =>
  (
    await api.sql<{ status: string; notes: string | null; reviewed_by: string | null }>(
      "select status, notes, reviewed_by from public.job_applicants where id = $1",
      [id],
    )
  )[0];

async function hiringDoc(c: Co, kind: "questionnaire" | "procedure", items: string[], title = `${kind} ${++seq}`) {
  const [row] = await api.sql<{ id: string }>(
    "insert into public.hiring_docs (organization_id, kind, title, items) values ($1, $2, $3, $4::jsonb) returning id",
    [c.org, kind, title, JSON.stringify(items)],
  );
  return row.id;
}
const auditFor = (id: string) =>
  api.sql<{ action: string; organization_id: string; after: Record<string, unknown> | null }>(
    "select action, organization_id, after from public.audit_log where entity_id = $1 order by created_at",
    [id],
  );
const membershipExists = async (id: string) =>
  (await api.sql("select 1 from public.memberships where id = $1", [id])).length === 1;
const loginExists = async (userId: string) => (await api.sql("select 1 from auth.users where id = $1", [userId])).length === 1;

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("applicants", () => {
  it("an owner moves an applicant along and keeps notes; managers and cleaners are told no", async () => {
    const c = await company();
    const id = await applicant(c);

    expect(await as(c.owner, () => applicants.setApplicantStatusAction(id, "interview")), api.log()).toEqual({ ok: true });
    expect(await applicantRow(id)).toMatchObject({ status: "interview", reviewed_by: c.owner.membershipId });
    expect(await as(c.owner, () => applicants.setApplicantStatusAction(id, "maybe"))).toEqual({ ok: false, error: "Invalid status" });
    expect(await as(c.olha, () => applicants.setApplicantStatusAction(id, "rejected"))).toEqual({ ok: false, error: "Not allowed" });
    expect(await as(c.anna, () => applicants.setApplicantStatusAction(id, "rejected"))).toEqual({ ok: false, error: "Not allowed" });
    expect((await applicantRow(id)).status).toBe("interview");

    expect(await as(c.admin, () => applicants.saveApplicantNotesAction(id, "  Great references, call back Monday  "))).toEqual({ ok: true });
    expect((await applicantRow(id)).notes).toBe("Great references, call back Monday");
    expect(await as(c.olha, () => applicants.saveApplicantNotesAction(id, "manager note"))).toEqual({ ok: false, error: "Not allowed" });
    expect(await as(c.owner, () => applicants.saveApplicantNotesAction(id, "   "))).toEqual({ ok: true });
    expect((await applicantRow(id)).notes, "blank notes clear the field").toBeNull();
  });

  it("another company's applicant is never changed or deleted", async () => {
    const c = await company();
    const other = await company();
    const theirs = await applicant(other, { notes: "their notes" });

    await as(c.owner, () => applicants.setApplicantStatusAction(theirs, "rejected"));
    await as(c.owner, () => applicants.saveApplicantNotesAction(theirs, "overwritten"));
    await as(c.owner, () => applicants.deleteApplicantAction(form({ id: theirs })));
    expect(await applicantRow(theirs)).toEqual({ status: "new", notes: "their notes", reviewed_by: null });
  });

  // FIX-LATER: setApplicantStatusAction and saveApplicantNotesAction answer ok to an update that matched no row (another company's id)
  it.fails("a status or note save that reached no applicant says so instead of ok", async () => {
    const c = await company();
    const other = await company();
    const theirs = await applicant(other);
    expect(await as(c.owner, () => applicants.setApplicantStatusAction(theirs, "rejected"))).toMatchObject({ ok: false });
    expect(await as(c.owner, () => applicants.saveApplicantNotesAction(theirs, "overwritten"))).toMatchObject({ ok: false });
  });

  it("is deleted by an owner or admin, and by nobody else", async () => {
    const c = await company();
    const id = await applicant(c);
    await as(c.olha, () => applicants.deleteApplicantAction(form({ id })));
    await as(c.anna, () => applicants.deleteApplicantAction(form({ id })));
    expect(await applicantRow(id), "a manager or cleaner can't").toBeTruthy();
    expect(await as(c.admin, () => applicants.deleteApplicantAction(form({ id })))).toEqual({ redirected: "/app/applicants" });
    expect(await applicantRow(id)).toBeUndefined();
  });

  it("hiring sends one invite carrying the wage and engagement, stamps the applicant hired, and won't send a second", async () => {
    const c = await company();
    const id = await applicant(c, { name: "Mariya Koval", email: "mariya.koval@example.com" });
    const hireForm = () =>
      form({ name: "Mariya Koval", email: "Mariya.Koval@example.com", role: "employee", engagement: "subcontractor", pay_rate: "$22.50" });

    const res = (await as(c.owner, () => applicants.hireApplicantAction(id, {}, hireForm()))) as { hired?: { token: string; emailSent: boolean } };
    expect(res, api.log()).toMatchObject({ hired: { emailSent: true, token: expect.any(String) } });
    const invites = await api.sql<{ email: string; role: string; engagement: string; pay_rate_cents: number; token: string; accepted_at: string | null }>(
      "select email::text as email, role::text as role, engagement, pay_rate_cents, token, accepted_at from public.invitations where organization_id = $1",
      [c.org],
    );
    expect(invites).toEqual([
      { email: "mariya.koval@example.com", role: "employee", engagement: "subcontractor", pay_rate_cents: 2250, token: res.hired!.token, accepted_at: null },
    ]);
    expect(await applicantRow(id)).toMatchObject({ status: "hired", reviewed_by: c.owner.membershipId });
    const mail = outbox.email.filter((m) => m.to === "mariya.koval@example.com");
    expect(mail).toHaveLength(1);
    expect(mail[0].html ?? mail[0].text ?? "").toContain(`/signup?invite=${res.hired!.token}`);

    // A second press: no second invite.
    expect(await as(c.owner, () => applicants.hireApplicantAction(id, {}, hireForm()))).toEqual({
      errors: { _form: "They're already marked hired — the invite was sent. Manage it from the Employees page." },
    });
    expect(await api.sql("select 1 from public.invitations where organization_id = $1", [c.org])).toHaveLength(1);

    // She opens the link: one membership, with what the hire dialog said.
    const [inv] = await api.sql<{ id: string }>("select id from public.invitations where organization_id = $1", [c.org]);
    const meta = { token: res.hired!.token, email: "mariya.koval@example.com", orgId: c.org, invitationId: inv.id, role: "employee" };
    await as(null, () => join.acceptInvitationAction(meta, {}, form({ full_name: "Mariya Koval", password: "a-long-password" })));
    await as(null, () => join.acceptInvitationAction(meta, {}, form({ full_name: "Mariya Koval", password: "a-long-password" })));
    const members = await api.sql<{ role: string; engagement: string; pay_rate_cents: number; status: string }>(
      `select m.role::text as role, m.engagement, m.pay_rate_cents, m.status::text as status
         from public.memberships m join auth.users u on u.id = m.profile_id where m.organization_id = $1 and u.email = 'mariya.koval@example.com'`,
      [c.org],
    );
    expect(members).toEqual([{ role: "employee", engagement: "subcontractor", pay_rate_cents: 2250, status: "active" }]);
  });

  it("hiring is the owner's or admin's, for this company's applicants, and never doubles a pending invite", async () => {
    const c = await company();
    const other = await company();
    const mine = await applicant(c, { email: "pending.person@example.com" });
    const theirs = await applicant(other, { email: "their.applicant@example.com" });
    const f = (email: string) => form({ name: "Someone", email, role: "employee", engagement: "employee", pay_rate: "20" });

    expect(await as(c.olha, () => applicants.hireApplicantAction(mine, {}, f("pending.person@example.com")))).toEqual({
      errors: { _form: "Only owners and admins can hire." },
    });
    expect(await as(c.owner, () => applicants.hireApplicantAction(theirs, {}, f("their.applicant@example.com")))).toEqual({
      errors: { _form: "Applicant not found." },
    });
    expect(await api.sql("select 1 from public.invitations where organization_id in ($1, $2)", [c.org, other.org])).toHaveLength(0);
    expect((await applicantRow(theirs)).status).toBe("new");

    // An invite is already out for this email (sent from the Employees page).
    await api.sql("insert into public.invitations (organization_id, email, role) values ($1, 'pending.person@example.com', 'employee')", [c.org]);
    const doubled = (await as(c.owner, () => applicants.hireApplicantAction(mine, {}, f("pending.person@example.com")))) as { errors?: Record<string, string> };
    expect(doubled.errors?.email).toBe("An invitation is already pending for this email.");
    expect((await applicantRow(mine)).status, "not stamped hired when no invite went out").toBe("new");
    expect(await api.sql("select 1 from public.invitations where organization_id = $1", [c.org])).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("the invite link a new hire opens", () => {
  async function invite(c: Co, over: { email?: string; role?: string; engagement?: string | null; pay?: number | null; expired?: boolean } = {}) {
    const email = over.email ?? `newhire${++seq}@example.com`;
    const [row] = await api.sql<{ id: string; token: string }>(
      `insert into public.invitations (organization_id, email, role, engagement, pay_rate_cents, expires_at)
       values ($1, $2, $3::public.membership_role, $4, $5, now() + ($6 || ' days')::interval) returning id, token`,
      [c.org, email, over.role ?? "employee", over.engagement ?? "employee", over.pay ?? null, over.expired ? "-1" : "14"],
    );
    return { ...row, email, meta: { token: row.token, email, orgId: c.org, invitationId: row.id, role: over.role ?? "employee" } };
  }
  const joinForm = (name = "Halyna Bondar", password = "a-long-password") => form({ full_name: name, password });

  it("creates her login and one membership with the hire's terms; the link is spent after", async () => {
    const c = await company();
    const inv = await invite(c, { engagement: "subcontractor", pay: 2250 });

    const res = await as(null, () => join.acceptInvitationAction(inv.meta, {}, joinForm()));
    expect(res, api.log()).toEqual({ redirected: `/login?joined=1&email=${encodeURIComponent(inv.email)}` });
    const members = await api.sql<{ role: string; status: string; engagement: string; pay_rate_cents: number; email: string }>(
      `select m.role::text as role, m.status::text as status, m.engagement, m.pay_rate_cents, u.email
         from public.memberships m join auth.users u on u.id = m.profile_id
        where m.organization_id = $1 and u.email = $2`,
      [c.org, inv.email],
    );
    expect(members).toEqual([{ role: "employee", status: "active", engagement: "subcontractor", pay_rate_cents: 2250, email: inv.email }]);
    const [{ accepted }] = await api.sql<{ accepted: boolean }>("select accepted_at is not null as accepted from public.invitations where id = $1", [inv.id]);
    expect(accepted).toBe(true);

    expect(await as(null, () => join.acceptInvitationAction(inv.meta, {}, joinForm()))).toMatchObject({
      errors: { _form: "This invitation has already been accepted." },
    });
    expect(gotrue.signups.filter((e) => e === inv.email), "one login").toHaveLength(1);
  });

  it("assigns the company's onboarding training once, and links a manually added record instead of making a second person", async () => {
    const c = await company();
    const [onboarding] = await api.sql<{ id: string }>(
      "insert into public.training_modules (organization_id, title, status, assign_on_join, audience_roles) values ($1, 'Welcome to the team', 'published', true, '{employee}') returning id",
      [c.org],
    );
    await api.sql("insert into public.training_modules (organization_id, title, status, assign_on_join, audience_roles) values ($1, 'Office only', 'published', true, '{manager}')", [c.org]);

    // Halyna has worked for months as a manual record (no login), with hours.
    const [shadow] = await api.sql<{ id: string }>(
      "insert into public.memberships (organization_id, profile_id, role, status, display_name, contact_email) values ($1, null, 'employee', 'active', 'Halyna B', 'halyna.shadow@example.com') returning id",
      [c.org],
    );
    await api.sql(
      "insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at) values ($1, $2, now() - interval '20 days', now() - interval '20 days' + interval '4 hours')",
      [c.org, shadow.id],
    );
    const inv = await invite(c, { email: "halyna.shadow@example.com", pay: 2300 });
    expect(await as(null, () => join.acceptInvitationAction(inv.meta, {}, joinForm())), api.log()).toMatchObject({ redirected: expect.stringContaining("/login?joined=1") });

    const people = await api.sql<{ id: string; linked: boolean; pay_rate_cents: number }>(
      `select m.id, m.profile_id is not null as linked, m.pay_rate_cents from public.memberships m
         left join auth.users u on u.id = m.profile_id
        where m.organization_id = $1 and (m.contact_email = 'halyna.shadow@example.com' or u.email = 'halyna.shadow@example.com')`,
      [c.org],
    );
    expect(people, "the same record, now with her login").toEqual([{ id: shadow.id, linked: true, pay_rate_cents: 2300 }]);
    expect(await api.sql("select 1 from public.time_entries where employee_id = $1", [shadow.id]), "her hours stay hers").toHaveLength(1);
    const assigned = await api.sql<{ module_id: string }>("select module_id from public.training_assignments where employee_id = $1", [shadow.id]);
    expect(assigned.map((a) => a.module_id), "the cleaners' onboarding module, once; not the office one").toEqual([onboarding.id]);
  });

  it("refuses a short password, a wrong token, an expired link, and an email that already has a login", async () => {
    const c = await company();
    const inv = await invite(c);
    expect(await as(null, () => join.acceptInvitationAction(inv.meta, {}, joinForm("Halyna", "short")))).toMatchObject({
      errors: { password: "Password must be at least 8 characters" },
    });
    expect(await as(null, () => join.acceptInvitationAction({ ...inv.meta, token: "not-the-token" }, {}, joinForm()))).toMatchObject({
      errors: { _form: "This invitation link is no longer valid." },
    });
    const old = await invite(c, { expired: true });
    expect(await as(null, () => join.acceptInvitationAction(old.meta, {}, joinForm()))).toMatchObject({
      errors: { _form: "This invitation has expired. Ask your admin to send a new one." },
    });

    // The email already has a login: she proves it's hers by signing in.
    const [{ email: existing }] = await api.sql<{ email: string }>("select email from auth.users where id = $1", [c.anna.userId]);
    const other = await company();
    const theirs = await invite(other, { email: existing });
    expect(await as(null, () => join.acceptInvitationAction(theirs.meta, {}, joinForm()))).toEqual({
      errors: { _form: `There is already a Sollos account for ${existing}. Sign in with it to accept this invite.` },
      values: { full_name: "Halyna Bondar" },
      signInHref: `/login?invite=${encodeURIComponent(theirs.token)}`,
    });
    expect(await api.sql("select 1 from public.memberships where organization_id = $1 and profile_id = $2", [other.org, c.anna.userId])).toHaveLength(0);
    expect(await api.sql("select 1 from public.memberships where organization_id = $1", [c.org])).toHaveLength(4);
  });
});

describe.skipIf(!hasPostgrest)("interviews", () => {
  it("starts from a questionnaire as a snapshot the library can't change afterwards", async () => {
    const c = await company();
    const id = await applicant(c);
    const doc = await hiringDoc(c, "questionnaire", ["Why cleaning?", "Do you drive?"], "Phone screen");

    expect(await as(c.owner, () => interviews.startInterviewAction(id, doc)), api.log()).toEqual({ ok: true });
    const rows = () =>
      api.sql<{ id: string; title: string; questions: string[]; answers: string[]; conducted_by: string; notes: string | null }>(
        "select id, title, questions, answers, conducted_by, notes from public.applicant_interviews where applicant_id = $1",
        [id],
      );
    const [started] = await rows();
    expect(started).toMatchObject({ title: "Phone screen", questions: ["Why cleaning?", "Do you drive?"], answers: ["", ""], conducted_by: c.owner.membershipId });

    // The library changes; the interview keeps the questions it was asked with.
    expect(await as(c.owner, () => hiring.saveHiringDocAction({}, form({ id: doc, kind: "questionnaire", title: "Phone screen v2", items: "Only one now" })))).toMatchObject({
      savedAt: expect.any(Number),
    });
    expect((await rows())[0].questions).toEqual(["Why cleaning?", "Do you drive?"]);
  });

  it("won't start from a procedure, an empty questionnaire, or anything of another company's, and only for owners and admins", async () => {
    const c = await company();
    const other = await company();
    const id = await applicant(c);
    const theirApplicant = await applicant(other);
    const procedure = await hiringDoc(c, "procedure", ["Check references"]);
    const empty = await hiringDoc(c, "questionnaire", []);
    const mine = await hiringDoc(c, "questionnaire", ["Q1"]);
    const theirs = await hiringDoc(other, "questionnaire", ["Their Q"]);

    expect(await as(c.owner, () => interviews.startInterviewAction(id, procedure))).toEqual({ ok: false, error: "Questionnaire not found." });
    expect(await as(c.owner, () => interviews.startInterviewAction(id, empty))).toEqual({ ok: false, error: "That questionnaire has no questions yet." });
    expect(await as(c.owner, () => interviews.startInterviewAction(id, theirs))).toEqual({ ok: false, error: "Questionnaire not found." });
    expect(await as(c.owner, () => interviews.startInterviewAction(theirApplicant, mine))).toEqual({ ok: false, error: "Applicant not found." });
    expect(await as(c.olha, () => interviews.startInterviewAction(id, mine))).toEqual({
      ok: false,
      error: "You don't have permission to run interviews.",
    });
    expect(await api.sql("select 1 from public.applicant_interviews where organization_id in ($1, $2)", [c.org, other.org])).toHaveLength(0);
  });

  it("saves one answer per question, and is deleted, only within the company and only by owners and admins", async () => {
    const c = await company();
    const other = await company();
    const id = await applicant(c);
    const doc = await hiringDoc(c, "questionnaire", ["Why cleaning?", "Do you drive?"]);
    await as(c.owner, () => interviews.startInterviewAction(id, doc));
    const [{ id: interview }] = await api.sql<{ id: string }>("select id from public.applicant_interviews where applicant_id = $1", [id]);
    const answersOf = async () =>
      (await api.sql<{ answers: string[]; notes: string | null }>("select answers, notes from public.applicant_interviews where id = $1", [interview]))[0];

    const saved = await as(c.admin, () =>
      interviews.saveInterviewAction(interview, form({ answer_0: "Likes order", answer_1: "Yes, own car", answer_2: "not a question", notes: "  Strong  " })),
    );
    expect(saved).toEqual({ ok: true });
    expect(await answersOf()).toEqual({ answers: ["Likes order", "Yes, own car"], notes: "Strong" });

    expect(await as(other.owner, () => interviews.saveInterviewAction(interview, form({ answer_0: "hijacked" })))).toEqual({
      ok: false,
      error: "Interview not found.",
    });
    expect(await as(c.olha, () => interviews.saveInterviewAction(interview, form({ answer_0: "manager" })))).toMatchObject({ ok: false });
    expect((await answersOf()).answers[0]).toBe("Likes order");

    expect(await as(other.owner, () => interviews.deleteInterviewAction(interview))).toEqual({ ok: false, error: "Interview not found." });
    expect(await as(c.olha, () => interviews.deleteInterviewAction(interview))).toMatchObject({ ok: false });
    expect(await answersOf()).toBeTruthy();
    expect(await as(c.owner, () => interviews.deleteInterviewAction(interview))).toEqual({ ok: true });
    expect(await answersOf()).toBeUndefined();
  });
});

describe.skipIf(!hasPostgrest)("the hiring library", () => {
  const docRow = async (id: string) =>
    (await api.sql<{ title: string; items: string[]; notes: string | null }>("select title, items, notes from public.hiring_docs where id = $1", [id]))[0];

  it("saves a questionnaire one item per line, edits it, and refuses what isn't one", async () => {
    const c = await company();
    const saved = await as(c.owner, () =>
      hiring.saveHiringDocAction({}, form({ kind: "questionnaire", title: "  First call  ", items: "Why us?\n\n  Weekends ok?  \n", notes: "" })),
    );
    expect(saved, api.log()).toMatchObject({ savedAt: expect.any(Number) });
    const [made] = await api.sql<{ id: string; kind: string; created_by: string }>(
      "select id, kind, created_by from public.hiring_docs where organization_id = $1",
      [c.org],
    );
    expect(made).toMatchObject({ kind: "questionnaire", created_by: c.owner.membershipId });
    expect(await docRow(made.id)).toEqual({ title: "First call", items: ["Why us?", "Weekends ok?"], notes: null });

    expect(await as(c.admin, () => hiring.saveHiringDocAction({}, form({ id: made.id, kind: "questionnaire", title: "First call", items: "Why us?", notes: "Ten minutes" })))).toMatchObject({
      savedAt: expect.any(Number),
    });
    expect(await docRow(made.id)).toEqual({ title: "First call", items: ["Why us?"], notes: "Ten minutes" });

    expect(await as(c.owner, () => hiring.saveHiringDocAction({}, form({ kind: "memo", title: "x", items: "a" })))).toEqual({ error: "Unknown document kind." });
    expect(await as(c.owner, () => hiring.saveHiringDocAction({}, form({ kind: "procedure", title: " ", items: "a" })))).toEqual({ error: "Give it a title." });
    expect(await as(c.owner, () => hiring.saveHiringDocAction({}, form({ kind: "procedure", title: "Steps", items: "\n \n" })))).toEqual({
      error: "Add at least one step (one per line).",
    });
    expect(await as(c.olha, () => hiring.saveHiringDocAction({}, form({ kind: "procedure", title: "Steps", items: "a" })))).toEqual({
      error: "Only owners and admins can edit the hiring library.",
    });
    expect(await api.sql("select 1 from public.hiring_docs where organization_id = $1", [c.org])).toHaveLength(1);
  });

  it("is deleted by an owner or admin; never by a manager, and never another company's", async () => {
    const c = await company();
    const other = await company();
    const mine = await hiringDoc(c, "procedure", ["Call references"]);
    const theirs = await hiringDoc(other, "procedure", ["Their step"], "Their procedure");

    await as(c.olha, () => hiring.deleteHiringDocAction(form({ id: mine })));
    expect(await docRow(mine)).toBeTruthy();
    await as(c.owner, () => hiring.deleteHiringDocAction(form({ id: theirs })));
    await as(c.owner, () => hiring.saveHiringDocAction({}, form({ id: theirs, kind: "procedure", title: "Renamed", items: "x" })));
    expect(await docRow(theirs)).toEqual({ title: "Their procedure", items: ["Their step"], notes: null });
    await as(c.admin, () => hiring.deleteHiringDocAction(form({ id: mine })));
    expect(await docRow(mine)).toBeUndefined();
  });

  // FIX-LATER: saveHiringDocAction answers "saved" (and logs an update) when the edit matched no row, e.g. another company's doc id
  it.fails("an edit that reached no document says so instead of saved", async () => {
    const c = await company();
    const other = await company();
    const theirs = await hiringDoc(other, "procedure", ["Their step"]);
    const res = await as(c.owner, () => hiring.saveHiringDocAction({}, form({ id: theirs, kind: "procedure", title: "Renamed", items: "x" })));
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  // FIX-LATER: deleteHiringDocAction writes a "delete" audit row even when nothing was deleted (another company's doc id)
  it.fails("the audit log doesn't record a delete that didn't happen", async () => {
    const c = await company();
    const other = await company();
    const theirs = await hiringDoc(other, "procedure", ["Their step"]);
    await as(c.owner, () => hiring.deleteHiringDocAction(form({ id: theirs })));
    expect(await docRow(theirs)).toBeTruthy();
    expect(await auditFor(theirs)).toEqual([]);
  });
});

describe.skipIf(!hasPostgrest)("an employee's documents", () => {
  const pdf = () => new File([Buffer.from("%PDF-1.4\n% offer letter\n")], "offer letter.pdf", { type: "application/pdf" });
  const notPdf = () => new File([Buffer.from("MZ not a pdf at all")], "offer.pdf", { type: "application/pdf" });

  it("an owner or admin files a document; the wrong file, person or role is refused and nothing is stored", async () => {
    const c = await company();
    const other = await company();
    const stored = () => [...api.storage.keys()].filter((k) => k.startsWith(`employee-documents/${c.org}/`) || k.startsWith(`employee-documents/${other.org}/`));

    const res = await as(c.admin, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ file: pdf(), category: "contract", label: "  Offer  " })));
    expect(res, api.log()).toEqual({ ok: true });
    const [doc] = await api.sql<{ category: string; label: string; file_name: string; file_path: string; uploaded_by: string; mime_type: string }>(
      "select category, label, file_name, file_path, uploaded_by, mime_type from public.membership_documents where membership_id = $1",
      [c.anna.membershipId],
    );
    expect(doc).toMatchObject({ category: "contract", label: "Offer", file_name: "offer letter.pdf", uploaded_by: c.admin.membershipId, mime_type: "application/pdf" });
    expect(doc.file_path.startsWith(`${c.org}/${c.anna.membershipId}/`)).toBe(true);
    expect(api.storage.has(`employee-documents/${doc.file_path}`)).toBe(true);

    expect(await as(c.owner, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ file: pdf(), category: "secret-stuff" })))).toEqual({ ok: true });
    expect(
      (await api.sql<{ category: string }>("select category from public.membership_documents where membership_id = $1 order by created_at", [c.anna.membershipId])).map((r) => r.category),
      "an unknown category files as other",
    ).toEqual(["contract", "other"]);

    expect(await as(c.owner, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ file: notPdf() })))).toEqual({ ok: false, error: "That file isn't a PDF." });
    expect(await as(c.owner, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ category: "id" })))).toEqual({ ok: false, error: "Choose a file to upload." });
    expect(await as(c.owner, () => documents.uploadEmployeeDocumentAction(other.anna.membershipId, form({ file: pdf() })))).toEqual({ ok: false, error: "Employee not found." });
    expect(await as(c.olha, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ file: pdf() })))).toEqual({
      ok: false,
      error: "You don't have permission to manage documents.",
    });
    expect(stored()).toHaveLength(2);
  });

  it("is deleted with its file, only within the company and only by owners and admins", async () => {
    const c = await company();
    const other = await company();
    await as(c.owner, () => documents.uploadEmployeeDocumentAction(c.anna.membershipId, form({ file: pdf() })));
    await as(other.owner, () => documents.uploadEmployeeDocumentAction(other.anna.membershipId, form({ file: pdf() })));
    const [mine] = await api.sql<{ id: string; file_path: string }>("select id, file_path from public.membership_documents where organization_id = $1", [c.org]);
    const [theirs] = await api.sql<{ id: string; file_path: string }>("select id, file_path from public.membership_documents where organization_id = $1", [other.org]);

    expect(await as(c.owner, () => documents.deleteEmployeeDocumentAction(theirs.id))).toEqual({ ok: false, error: "Document not found." });
    expect(await as(c.olha, () => documents.deleteEmployeeDocumentAction(mine.id))).toMatchObject({ ok: false });
    expect(api.storage.has(`employee-documents/${theirs.file_path}`)).toBe(true);
    expect(api.storage.has(`employee-documents/${mine.file_path}`)).toBe(true);

    expect(await as(c.admin, () => documents.deleteEmployeeDocumentAction(mine.id))).toEqual({ ok: true });
    expect(await api.sql("select 1 from public.membership_documents where id = $1", [mine.id])).toHaveLength(0);
    expect(api.storage.has(`employee-documents/${mine.file_path}`)).toBe(false);
    expect(await api.sql("select 1 from public.membership_documents where id = $1", [theirs.id])).toHaveLength(1);
  });
});

describe.skipIf(!hasPostgrest)("removing someone", () => {
  async function disable(m: Member) {
    await api.sql("update public.memberships set status = 'disabled', deactivated_at = now() where id = $1", [m.membershipId]);
  }
  async function shift(org: string, m: Member) {
    await api.sql(
      `insert into public.time_entries (organization_id, employee_id, clock_in_at, clock_out_at)
       values ($1, $2, now() - interval '30 days', now() - interval '30 days' + interval '3 hours')`,
      [org, m.membershipId],
    );
  }

  it("deleting a deactivated employee is the owner's, and every refusal says why and removes nothing", async () => {
    const c = await company();
    const other = await company();
    const gone = await addMember(api.sql, c.org, "employee", "Leaving");
    const worked = await addMember(api.sql, c.org, "employee", "Worked");
    const bonused = await addMember(api.sql, c.org, "employee", "Bonused");
    await disable(gone);
    await disable(worked);
    await disable(bonused);
    await disable(other.anna);
    await shift(c.org, worked);
    await api.sql("insert into public.bonuses (organization_id, employee_id, period_start, period_end, amount_cents) values ($1, $2, current_date - 30, current_date - 1, 5000)", [
      c.org,
      bonused.membershipId,
    ]);
    const del = (who: Member, id: string) => as(who, () => employees.deleteEmployeeAction(undefined, form({ id })));

    expect(await del(c.admin, gone.membershipId)).toEqual({ error: "Only owners can permanently delete employees." });
    expect(await del(c.owner, c.owner.membershipId)).toEqual({ error: "You cannot delete your own account." });
    expect(await del(c.owner, c.anna.membershipId)).toEqual({ error: "Only disabled employees can be deleted. Deactivate them first." });
    expect(await del(c.owner, other.anna.membershipId)).toEqual({ error: "Employee not found." });
    expect((await del(c.owner, worked.membershipId)) as { error: string }).toMatchObject({ error: expect.stringContaining("1 recorded shift") });
    expect((await del(c.owner, bonused.membershipId)) as { error: string }).toMatchObject({ error: expect.stringContaining("1 bonus") });
    for (const m of [gone, worked, bonused, c.anna, other.anna]) expect(await membershipExists(m.membershipId)).toBe(true);

    expect(await del(c.owner, gone.membershipId), api.log()).toEqual({ redirected: "/app/employees" });
    expect(await membershipExists(gone.membershipId)).toBe(false);
    expect((await auditFor(gone.membershipId)).map((a) => a.action)).toEqual(["delete"]);
    expect(await loginExists(gone.userId), "delete keeps the login; only force remove takes it").toBe(true);
  });

  it("force remove takes the membership and the login, for the owner only, and never someone with history or of another company", async () => {
    const c = await company();
    const other = await company();
    const stuck = await addMember(api.sql, c.org, "employee", "Stuck", "invited");
    const worked = await addMember(api.sql, c.org, "employee", "Worked");
    await shift(c.org, worked);
    const force = (who: Member, id: string) => as(who, () => employees.forceDeleteEmployeeAction(undefined, form({ id })));

    expect(await force(c.admin, stuck.membershipId)).toEqual({ error: "Only owners can force-remove employees." });
    expect(await force(c.owner, c.owner.membershipId)).toEqual({ error: "You cannot remove your own account." });
    expect(await force(c.owner, other.anna.membershipId)).toEqual({ error: "Employee not found." });
    expect((await force(c.owner, worked.membershipId)) as { error: string }).toMatchObject({ error: expect.stringContaining("Generate recovery link") });
    expect(await membershipExists(worked.membershipId)).toBe(true);
    expect(await loginExists(worked.userId), "refused before the login was touched").toBe(true);
    expect(await membershipExists(other.anna.membershipId)).toBe(true);
    expect(await loginExists(other.anna.userId)).toBe(true);

    expect(await force(c.owner, stuck.membershipId), api.log()).toEqual({ redirected: "/app/employees" });
    expect(await membershipExists(stuck.membershipId)).toBe(false);
    expect(await loginExists(stuck.userId)).toBe(false);
    expect((await auditFor(stuck.membershipId)).map((a) => a.after === null && a.action)).toEqual(["delete"]);
  });

  // FIX-LATER: forceDeleteEmployeeAction deletes the person's whole login, which cascades to their membership in every other company
  it.fails("force remove never reaches the same person's membership in another company", async () => {
    const c = await company();
    const other = await company();
    // Bea cleans for both companies with one login.
    const bea = await addMember(api.sql, c.org, "employee", "Bea");
    const [theirs] = await api.sql<{ id: string }>(
      "insert into public.memberships (organization_id, profile_id, role, status) values ($1, $2, 'employee', 'active') returning id",
      [other.org, bea.userId],
    );
    await as(c.owner, () => employees.forceDeleteEmployeeAction(undefined, form({ id: bea.membershipId })));
    expect(await membershipExists(theirs.id), "her place at the other company").toBe(true);
    expect(await loginExists(bea.userId), "the login she signs in to the other company with").toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("a recovery link handed over by the office", () => {
  it("an owner or admin mints one for a teammate, and it is audited", async () => {
    const c = await company();
    const [{ email }] = await api.sql<{ email: string }>("select email from auth.users where id = $1", [c.anna.userId]);
    const res = await as(c.admin, () => employees.generateRecoveryLinkAction(c.anna.membershipId));
    expect(res, api.log()).toEqual({
      ok: true,
      url: "https://sollos3.com/auth/callback?token_hash=hashed-recovery-token&type=recovery",
      email,
      expires_in_minutes: 60,
    });
    const audit = (await auditFor(c.anna.membershipId)).filter((a) => a.action === "generate_recovery_link");
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ email });
    expect(JSON.stringify(audit[0].after)).not.toContain("hashed-recovery-token");
  });

  it("is refused to cleaners and managers, to an admin for an owner, for a manual record, for a shared login, and across companies", async () => {
    const c = await company();
    const other = await company();
    const [shadow] = await api.sql<{ id: string }>(
      "insert into public.memberships (organization_id, profile_id, role, status, display_name) values ($1, null, 'employee', 'active', 'Shadow Sister') returning id",
      [c.org],
    );
    const shared = await addMember(api.sql, c.org, "employee", "Shared");
    await api.sql("insert into public.memberships (organization_id, profile_id, role, status) values ($1, $2, 'employee', 'active')", [other.org, shared.userId]);
    const link = (who: Member, id: string) => as(who, () => employees.generateRecoveryLinkAction(id));
    const before = gotrue.links.length;

    expect(await link(c.anna, c.owner.membershipId)).toEqual({ ok: false, error: "Only owners and admins can generate recovery links." });
    expect(await link(c.olha, c.anna.membershipId)).toEqual({ ok: false, error: "Only owners and admins can generate recovery links." });
    expect(await link(c.admin, c.owner.membershipId)).toEqual({ ok: false, error: "Only an owner can generate a recovery link for an owner." });
    expect(await link(c.owner, shadow.id)).toMatchObject({ ok: false, error: expect.stringContaining("added manually") });
    expect(await link(c.owner, shared.membershipId)).toMatchObject({ ok: false, error: expect.stringContaining("another workspace") });
    expect(await link(c.owner, other.anna.membershipId)).toEqual({ ok: false, error: "Employee not found in your organization." });
    expect(gotrue.links.length, "no token was minted").toBe(before);
  });
});

describe.skipIf(!hasPostgrest)("withdrawing an invitation", () => {
  it("an owner or admin withdraws one; a manager and another company can't", async () => {
    const c = await company();
    const other = await company();
    const invite = async (org: string, email: string) =>
      (await api.sql<{ id: string }>("insert into public.invitations (organization_id, email, role) values ($1, $2, 'employee') returning id", [org, email]))[0].id;
    const mine = await invite(c.org, "withdraw.me@example.com");
    const theirs = await invite(other.org, "keep.me@example.com");
    const exists = async (id: string) => (await api.sql("select 1 from public.invitations where id = $1", [id])).length === 1;

    await as(c.olha, () => employees.revokeInvitationAction(form({ id: mine })));
    expect(await exists(mine), "a manager can't").toBe(true);
    await as(c.owner, () => employees.revokeInvitationAction(form({ id: theirs })));
    expect(await exists(theirs)).toBe(true);
    expect(await auditFor(theirs)).toEqual([]);

    await as(c.admin, () => employees.revokeInvitationAction(form({ id: mine })));
    expect(await exists(mine)).toBe(false);
    const audit = await auditFor(mine);
    expect(audit.map((a) => a.action)).toEqual(["delete"]);
  });
});
