/**
 * Quiet mode: a company that sends nothing (2026-11-24).
 *
 * The Velluma demo account had automations off and every notice topic muted
 * on its owner, and still emailed "Fatima hasn't clocked in" to five office
 * accounts. Quiet mode is read at every door a message leaves by: notify,
 * the email senders, the text sender, the phone-alert sender.
 *
 * The real senders, the real switch and the real pages, on a real database.
 * The phone and the email notify hands off to are caught; the lower doors are
 * called for real and must refuse before anything is sent.
 */
import { randomBytes } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

const outbox = vi.hoisted(() => ({ push: [] as Array<{ to: string; title: string }>, email: [] as Array<{ to: string; subject: string }> }));
vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => ({
  ...(await import("./next-stubs")).nextNavigation(),
  // The Settings page renders client controls that ask for the router.
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {} }),
  usePathname: () => "/app/settings/automations",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  sendPushToMembership: async (to: string, p: { title: string }) => {
    outbox.push.push({ to, title: p.title });
    return 1;
  },
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  isEmailConfigured: () => true,
  sendOrgEmail: async (_o: string, a: { to: string; subject: string }) => {
    outbox.email.push({ to: a.to, subject: a.subject });
    return true;
  },
}));

let api: Api;
let restoreEnv: () => void;

beforeAll(async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY ??= `base64:${randomBytes(32).toString("base64")}`;
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
  outbox.push.length = 0;
  outbox.email.length = 0;
});

type Co = { org: string; owner: Member; manager: Member };
async function company(quiet: boolean): Promise<Co> {
  const org = await addOrg(api.sql, quiet ? "Quiet Co" : "Loud Co");
  const co = { org, owner: await addMember(api.sql, org, "owner", "Owner"), manager: await addMember(api.sql, org, "manager", "Manager") };
  for (const [name, m] of Object.entries({ owner: co.owner, manager: co.manager })) {
    await api.sql("update public.memberships set contact_email = $2 where id = $1", [m.membershipId, `${name}-${m.membershipId.slice(0, 6)}@example.test`]);
  }
  // Automations ON: quiet mode must hold even with everything else switched on.
  await api.sql("update public.organizations set quiet_mode = $2, automations_enabled = true, sms_enabled = true, sms_from_number = '+15875550100' where id = $1", [org, quiet]);
  return co;
}

const lateAlert = (org: string) => ({
  audience: "org-management" as const,
  organizationId: org,
  topic: "clock" as const,
  title: "Fatima hasn't clocked in",
  body: "Her 4 PM job started 30 minutes ago. Answer it on your dashboard.",
  href: "/app",
  channels: { email: true },
});
const bell = async (org: string, title: string) =>
  (await api.sql<{ n: number }>("select count(*)::int as n from public.notifications where organization_id = $1 and title = $2", [org, title]))[0].n;

describe.skipIf(!hasPostgrest)("quiet mode", { timeout: 120_000 }, () => {
  it("a quiet company's office gets the bell and nothing else; a company not in quiet mode is alerted as before", async () => {
    const { notify } = await import("@/lib/notify");
    const quiet = await company(true);
    await notify(lateAlert(quiet.org));
    expect(await bell(quiet.org, "Fatima hasn't clocked in"), api.log()).toBe(2);
    expect(outbox.push).toEqual([]);
    expect(outbox.email).toEqual([]);

    const loud = await company(false);
    await notify(lateAlert(loud.org));
    expect(outbox.push.map((p) => p.to).sort()).toEqual([loud.owner.membershipId, loud.manager.membershipId].sort());
    expect(outbox.email).toHaveLength(2);
  });

  it("every lower door refuses for a quiet company before anything is sent: email, the company's own email, a text, a phone alert", async () => {
    const quiet = await company(true);
    const email = await vi.importActual<typeof import("@/lib/email")>("@/lib/email");
    const { QUIET_MODE_REASON } = await import("@/lib/quiet-mode");

    // A direct email about the company's work (crew schedules, digests).
    expect(await email.sendEmailDetailed({ organizationId: quiet.org, to: "crew@example.test", subject: "Your week", html: "<p>Hi</p>" })).toEqual({
      ok: false,
      reason: QUIET_MODE_REASON,
    });
    // The company's own email, even one sent by hand (pauseExempt).
    expect(await email.sendOrgEmailDetailed(quiet.org, { to: "client@example.test", subject: "Invoice", html: "<p>Hi</p>", pauseExempt: true })).toEqual({
      ok: false,
      reason: QUIET_MODE_REASON,
    });
    // Nothing was counted against the daily cap for a send that never happened.
    const counted = await api.sql<{ n: number }>(
      "select coalesce(sum(sent), 0)::int as n from public.org_email_counters where organization_id = $1",
      [quiet.org],
    );
    expect(counted[0].n).toBe(0);

    // A text, even a manual key that skips the automation gates.
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    try {
      const { sendOrgSms } = await import("@/lib/sms");
      const r = await sendOrgSms(quiet.org, { to: "+15875550142", body: "Shift open", automationKey: "freelancer_offer_sms" });
      expect(r).toMatchObject({ ok: true, status: "skipped_disabled" });
      expect(logs.some((l) => l.includes(`org ${quiet.org} is in quiet mode`))).toBe(true);
    } finally {
      spy.mockRestore();
    }

    // A phone alert straight to a person. (No VAPID keys here, so the real
    // sender would return 0 anyway; what's checked is that it reads the
    // switch at all: the quiet read comes before the subscription lookup.)
    const { isOrgQuiet } = await import("@/lib/quiet-mode");
    expect(await isOrgQuiet(quiet.org)).toBe(true);
    expect(await isOrgQuiet((await company(false)).org)).toBe(false);
    expect(await isOrgQuiet("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("the owner turns it on and off from Settings; a manager can't; the page and the banner say so", async () => {
    const c = await company(false);
    const { setQuietModeAction } = await import("@/app/app/settings/automations/actions");
    const flip = async (who: Member, quiet: boolean) => {
      request.cookies = api.sessionCookies(who.userId);
      const f = new FormData();
      f.set("quiet", String(quiet));
      try {
        await setQuietModeAction(f);
      } finally {
        await settle();
      }
    };
    const stored = async () => (await api.sql<{ q: boolean }>("select quiet_mode as q from public.organizations where id = $1", [c.org]))[0].q;

    await flip(c.manager, true);
    expect(await stored()).toBe(false);

    await flip(c.owner, true);
    expect(await stored(), api.log()).toBe(true);

    request.cookies = api.sessionCookies(c.owner.userId);
    const { default: ClientMessagesPage } = await import("@/app/app/settings/automations/page");
    const page = renderToStaticMarkup(await ClientMessagesPage());
    expect(page).toContain("Quiet mode is on");
    expect(page).toContain("Turn quiet mode off");

    const { AutomationsOffBanner } = await import("@/components/automations-off-banner");
    const banner = (role: string) => AutomationsOffBanner({ organizationId: c.org, role }).then((el) => (el ? renderToStaticMarkup(el) : ""));
    expect(await banner("owner")).toContain("Quiet mode is on");
    expect(await banner("owner")).toContain("Turn it off");
    // The whole office sees why nothing arrives; only owner and admin get the link.
    expect(await banner("manager")).toContain("Quiet mode is on");
    expect(await banner("manager")).not.toContain("Turn it off");

    await flip(c.owner, false);
    expect(await stored()).toBe(false);
    expect(await banner("manager")).toBe("");
  });
});
