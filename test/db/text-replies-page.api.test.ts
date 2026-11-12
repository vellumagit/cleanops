/**
 * The Text replies page (app/app/texts), rendered as the people who use it.
 *
 * Replies are saved by the inbound webhook (sms-replies.api.test.ts covers
 * that). This renders the page through the real session, policies and sender
 * lookup: a manager sees who wrote what, a cleaner is sent away, and one
 * company never sees another's.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addClient, addMember, addOrg, type Member } from "./harness";
import { request } from "./next-stubs";

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
});

async function render(who: Member): Promise<string> {
  request.cookies = api.sessionCookies(who.userId);
  const { default: TextRepliesPage } = await import("@/app/app/texts/page");
  return renderToStaticMarkup(await TextRepliesPage());
}

const reply = (org: string, from: string, body: string, minutesAgo: number) =>
  api.sql(
    `insert into public.sms_messages (organization_id, direction, to_number, from_number, body, status, created_at)
     values ($1, 'inbound', '+15875550000', $2, $3, 'received', now() - make_interval(mins => $4))`,
    [org, from, body, minutesAgo],
  );

describe.skipIf(!hasPostgrest)("the Text replies page", { timeout: 90_000 }, () => {
  it("shows a manager who wrote what, newest first, with a way to text back", async () => {
    const org = await addOrg(api.sql, "Company");
    await api.sql("update public.organizations set sms_from_number = '+15875550000', timezone = 'America/Edmonton' where id = $1", [org]);
    const manager = await addMember(api.sql, org, "manager", "Manager");
    const dana = await addClient(api.sql, org, "Dana");
    await api.sql("update public.clients set name = 'Dana Lee', phone = '780-555-0101' where id = $1", [dana]);
    const olha = await addMember(api.sql, org, "employee", "Olha");
    await api.sql("update public.memberships set display_name = 'Olha M', contact_phone = '(780) 555-0202' where id = $1", [olha.membershipId]);

    await reply(org, "+17805550101", "Can we move Friday to Thursday?", 30);
    await reply(org, "+17805550202", "Running 10 min late", 10);
    await reply(org, "+14035550404", "[picture or file]", 5);

    const other = await addOrg(api.sql, "Other");
    await reply(other, "+17805550999", "Not yours to read", 1);

    const html = await render(manager);
    expect(html).toContain("Dana Lee");
    expect(html).toContain(`href="/app/clients/${dana}"`);
    expect(html).toContain("Can we move Friday to Thursday?");
    expect(html).toContain("Olha M");
    expect(html).toContain(`href="/app/employees/${olha.membershipId}"`);
    expect(html).toContain("(403) 555-0404");
    expect(html).toContain("Sent a picture or file");
    expect(html).toContain('href="sms:+17805550101"');
    expect(html).not.toContain("Not yours to read");
    // Newest first.
    expect(html.indexOf("(403) 555-0404")).toBeLessThan(html.indexOf("Olha M"));
    expect(html.indexOf("Olha M")).toBeLessThan(html.indexOf("Dana Lee"));
  });

  it("says so when nothing has come in, and when texting isn't set up", async () => {
    const org = await addOrg(api.sql, "Quiet");
    const owner = await addMember(api.sql, org, "owner", "Owner");
    const html = await render(owner);
    expect(html).toContain("No replies yet");
    expect(html).toContain("Texting isn’t set up");
  });

  it("is not for cleaners", async () => {
    const org = await addOrg(api.sql, "Company");
    const cleaner = await addMember(api.sql, org, "employee", "Cleaner");
    await expect(render(cleaner)).rejects.toThrow(/redirected/);
  });
});
