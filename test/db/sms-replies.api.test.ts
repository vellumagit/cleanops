/**
 * A reply to the company's texts reaches the office (decided 2026-11-11).
 *
 * The inbound webhook used to act on STOP / START / HELP and drop every other
 * message. These post real, signed Twilio requests to the route and check
 * what the database ends up with: the reply saved, the sender named, the
 * office told in the app, email at most once per sender per half hour, and
 * nothing for cleaners. Only the outbound email is caught instead of sent.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";

type Mail = { to: string; subject: string; text: string };
const outbox = vi.hoisted(() => ({ email: [] as Mail[] }));

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendOrgEmail: async (_org: string, args: Mail) => {
    outbox.email.push({ to: args.to, subject: args.subject, text: args.text });
    return true;
  },
}));

const TOKEN = "test-twilio-auth-token";
const HOST = "sms.test.local";

let api: Api;
let restoreEnv: () => void;
const savedToken = process.env.TWILIO_AUTH_TOKEN;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
}, 240_000);

afterAll(async () => {
  if (savedToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = savedToken;
  restoreEnv?.();
  await api?.stop();
});

let sid = 0;
async function text(fields: { From: string; To: string; Body: string; MessageSid?: string; NumMedia?: string }, token = TOKEN) {
  const { POST } = await import("@/app/api/sms/inbound/route");
  const params = new URLSearchParams({ MessageSid: `SM${++sid}`, ...fields });
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signature = createHmac("sha1", token)
    .update(`https://${HOST}/api/sms/inbound` + sorted.map(([k, v]) => k + v).join(""))
    .digest("base64");
  const res = await POST(
    new Request(`https://${HOST}/api/sms/inbound`, {
      method: "POST",
      headers: {
        host: HOST,
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
        "x-forwarded-for": "203.0.113.9",
      },
      body: params.toString(),
    }) as never,
  );
  return { status: res.status, xml: await res.text(), sid: params.get("MessageSid")! };
}

type Co = { org: string; number: string; owner: Member; manager: Member; cleaner: Member; ownerEmail: string; managerEmail: string };
let orgN = 0;
async function company(): Promise<Co> {
  const org = await addOrg(api.sql, "Company");
  const number = `+1587555${String(1000 + ++orgN)}`;
  await api.sql("update public.organizations set sms_enabled = true, sms_from_number = $2 where id = $1", [org, number]);
  const owner = await addMember(api.sql, org, "owner", "Owner");
  const manager = await addMember(api.sql, org, "manager", "Manager");
  const cleaner = await addMember(api.sql, org, "employee", "Cleaner");
  const ownerEmail = `owner${orgN}@example.test`;
  const managerEmail = `manager${orgN}@example.test`;
  for (const [m, email] of [
    [owner, ownerEmail],
    [manager, managerEmail],
    [cleaner, `cleaner${orgN}@example.test`],
  ] as const) {
    await api.sql("update public.memberships set contact_email = $2 where id = $1", [m.membershipId, email]);
  }
  return { org, number, owner, manager, cleaner, ownerEmail, managerEmail };
}

const told = (membershipId: string) =>
  api.sql<{ title: string; body: string; href: string }>(
    "select title, body, href from public.notifications where recipient_membership_id = $1 order by created_at",
    [membershipId],
  );
const saved = (org: string) =>
  api.sql<{ direction: string; from_number: string; body: string; status: string; client_id: string | null; twilio_sid: string }>(
    "select direction, from_number, body, status, client_id, twilio_sid from public.sms_messages where organization_id = $1 order by created_at",
    [org],
  );

describe.skipIf(!hasPostgrest)("replies to the company's texts reach the office", { timeout: 90_000 }, () => {
  it("saves a client's reply, tells owners and managers, emails them once, and texts nothing back", async () => {
    const c = await company();
    const client = await addClient(api.sql, c.org, "Dana");
    await api.sql("update public.clients set name = 'Dana Lee', phone = '(780) 555-0101' where id = $1", [client]);

    outbox.email.length = 0;
    const first = await text({ From: "+17805550101", To: c.number, Body: "Can we move Friday's clean to Thursday?" });
    expect(first.status, api.log()).toBe(200);
    expect(first.xml).not.toContain("<Message>");

    expect(await saved(c.org)).toEqual([
      {
        direction: "inbound",
        from_number: "+17805550101",
        body: "Can we move Friday's clean to Thursday?",
        status: "received",
        client_id: client,
        twilio_sid: first.sid,
      },
    ]);
    for (const m of [c.owner, c.manager]) {
      expect(await told(m.membershipId)).toEqual([
        {
          title: "Text from Dana Lee (client)",
          body: "“Can we move Friday's clean to Thursday?” From (780) 555-0101.",
          href: `/app/clients/${client}`,
        },
      ]);
    }
    expect(await told(c.cleaner.membershipId)).toEqual([]);
    expect(outbox.email.map((e) => e.to).sort()).toEqual([c.managerEmail, c.ownerEmail].sort());

    // Twilio delivering the same message again changes nothing.
    await text({ From: "+17805550101", To: c.number, Body: "Can we move Friday's clean to Thursday?", MessageSid: first.sid });
    expect(await saved(c.org)).toHaveLength(1);
    expect(await told(c.owner.membershipId)).toHaveLength(1);
    expect(outbox.email).toHaveLength(2);

    // A second message inside half an hour: saved and shown, not emailed.
    await text({ From: "+17805550101", To: c.number, Body: "Or Saturday works too" });
    expect(await saved(c.org)).toHaveLength(2);
    expect((await told(c.owner.membershipId)).map((n) => n.body)).toContain("“Or Saturday works too” From (780) 555-0101.");
    expect(outbox.email).toHaveLength(2);
  });

  it("names team members, freelancers and unknown numbers, and says when a picture came", async () => {
    const c = await company();
    const olha = await addMember(api.sql, c.org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha M', contact_phone = '780-555-0202' where id = $1", [
      olha.membershipId,
    ]);
    await api.sql(
      "insert into public.freelancer_contacts (organization_id, full_name, phone) values ($1, 'Ivan Bench', '+1 780 555 0303')",
      [c.org],
    );

    await text({ From: "+17805550202", To: c.number, Body: "Running 10 min late" });
    await text({ From: "+17805550303", To: c.number, Body: "I can take Saturday" });
    await text({ From: "+14035550404", To: c.number, Body: "", NumMedia: "1" });

    const notes = await told(c.manager.membershipId);
    expect(notes).toEqual([
      { title: "Text from Olha M", body: "“Running 10 min late” From (780) 555-0202.", href: `/app/employees/${olha.membershipId}` },
      { title: "Text from Ivan Bench (freelancer)", body: "“I can take Saturday” From (780) 555-0303.", href: "/app/freelancers" },
      { title: "Text from (403) 555-0404", body: "[sent a picture or file]", href: "/app" },
    ]);
    expect((await saved(c.org)).map((r) => r.body)).toEqual(["Running 10 min late", "I can take Saturday", "[picture or file]"]);
  });

  it("still honours STOP, ignores forged requests, and keeps one company's replies from another", async () => {
    const c = await company();
    const other = await company();
    const client = await addClient(api.sql, c.org);
    await api.sql("update public.clients set phone = '+17805550505', sms_opted_in = true where id = $1", [client]);

    const stop = await text({ From: "+17805550505", To: c.number, Body: "STOP" });
    expect(stop.xml).toContain("unsubscribed");
    expect((await api.sql<{ sms_opted_in: boolean }>("select sms_opted_in from public.clients where id = $1", [client]))[0])
      .toEqual({ sms_opted_in: false });

    const forged = await text({ From: "+17805550505", To: c.number, Body: "hello" }, "not-the-token");
    expect(forged.status).toBe(403);

    // A reply to the other company's number is theirs, sender unknown to them.
    await text({ From: "+17805550505", To: other.number, Body: "wrong company?" });

    expect(await saved(c.org)).toEqual([]);
    expect(await told(c.owner.membershipId)).toEqual([]);
    expect((await told(other.owner.membershipId)).map((n) => n.title)).toEqual(["Text from (780) 555-0505"]);
  });
});
