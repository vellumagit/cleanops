/**
 * Settings → Text messages, pressed as an owner presses it against a real
 * database behind the real PostgREST.
 *
 *   turn texting on / off      the company's own number, the SMS automations,
 *                              and the metered overage item on its Stripe plan
 *   the monthly overage cap    dollars in, cents stored
 *   US registration (A2P)      save, submit, "Check now", and the hourly cron
 *
 * Twilio is not live here (TWILIO_ENABLED unset), which is the app's own
 * simulated mode: a number is "bought" as Twilio's magic test number and the
 * carriers "approve" one step per look, with nothing sent anywhere. The
 * Stripe SDK is a fake that records the overage item it is asked to attach
 * or remove.
 *
 * What each owes: only an owner or admin can turn texting on or off, change
 * the cap, or register the business; a lapsed subscription can't switch on
 * something that spends money; a US business can't text before the carriers
 * approve it; the EIN is stored encrypted and never needs typing twice; a
 * registration with the carriers can't be edited underneath them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

type Call = { method: string; args: unknown[] };
const stripeFake = vi.hoisted(() => ({ calls: [] as Call[], seq: 0 }));
vi.mock("stripe", () => {
  class FakeStripe {
    subscriptionItems = {
      create: async (...args: unknown[]) => {
        stripeFake.calls.push({ method: "subscriptionItems.create", args });
        return { id: `si_test_${++stripeFake.seq}` };
      },
      del: async (...args: unknown[]) => {
        stripeFake.calls.push({ method: "subscriptionItems.del", args });
        return { id: args[0], deleted: true };
      },
    };
  }
  return { default: FakeStripe };
});

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

// Test values only; none of these is a real secret.
const CRON_SECRET = "payments-sms-test-cron-secret";
process.env.CRON_SECRET = CRON_SECRET;
process.env.STRIPE_ENABLED = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_sollos_sms_not_real";
process.env.STRIPE_PRICE_SMS_OVERAGE = "price_test_sms_overage";
process.env.INTEGRATION_ENCRYPTION_KEY = `base64:${randomBytes(32).toString("base64")}`;
delete process.env.TWILIO_ENABLED;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;

// Nothing in this file may reach Twilio: simulated mode never calls it, and
// this proves it.
const realFetch = globalThis.fetch;
const outside: string[] = [];
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/twilio\.com/.test(url)) {
    outside.push(url);
    return new Response(JSON.stringify({ message: "stand-in: Twilio is not reachable from tests" }), { status: 503 });
  }
  return realFetch(input, init);
});

const sms = await import("@/app/app/settings/sms/actions");
const registration = await import("@/app/app/settings/sms/registration-actions");
const { GET: registrationsCron } = await import("@/app/api/cron/sms-registrations/route");
const { maybeDecryptField } = await import("@/lib/field-encryption");

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
  stripeFake.calls.length = 0;
  outside.length = 0;
});

/** Signed in as this member; a redirect is an answer too. */
async function as<T>(m: Member, press: () => Promise<T>): Promise<T | { redirected: string }> {
  request.cookies = api.sessionCookies(m.userId);
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

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

let seq = 0;

async function company(where: "CA" | "US" = "CA", name = "Text Co") {
  const org = await addOrg(api.sql, name);
  await api.sql(
    `update public.organizations
        set timezone = $2, holiday_region = $3, contact_phone = $4,
            automation_settings = '{"invoice_overdue_reminder":{"enabled":true},"booking_confirmation_sms":{"enabled":false,"template":"kept"}}'::jsonb
      where id = $1`,
    [org, where === "CA" ? "America/Edmonton" : "America/New_York", where === "CA" ? "CA-AB" : "US-FL", where === "CA" ? "+14035550100" : "+18135550100"],
  );
  return {
    org,
    owner: await addMember(api.sql, org, "owner", "Svitlana"),
    admin: await addMember(api.sql, org, "admin", "Admin"),
    manager: await addMember(api.sql, org, "manager", "Olha"),
    anna: await addMember(api.sql, org, "employee", "Anna"),
  };
}
type Co = Awaited<ReturnType<typeof company>>;

const orgSms = async (org: string) =>
  (
    await api.sql<{
      sms_enabled: boolean;
      sms_from_number: string | null;
      sms_number_sid: string | null;
      sms_overage_item_id: string | null;
      sms_overage_cap_cents: number | null;
      automation_settings: Record<string, { enabled?: boolean; template?: string }>;
    }>(
      "select sms_enabled, sms_from_number, sms_number_sid, sms_overage_item_id, sms_overage_cap_cents, automation_settings from public.organizations where id = $1",
      [org],
    )
  )[0];

const subscribed = (c: Co, status = "active") =>
  api.sql("insert into public.subscriptions (organization_id, stripe_customer_id, stripe_subscription_id, status) values ($1, $2, $3, $4)", [
    c.org,
    `cus_sms_${++seq}`,
    `sub_sms_${seq}`,
    status,
  ]);

const REG = {
  legal_name: "Svit Cleaning LLC",
  brand_name: "",
  business_type: "Limited Liability Corporation",
  company_type: "private",
  stock_exchange: "",
  stock_ticker: "",
  ein: "12-3456789",
  industry: "PROFESSIONAL_SERVICES",
  website_url: "svitcleaning.example.com",
  street: "100 Main St",
  street2: "",
  city: "Tampa",
  state: "fl",
  postal_code: "33602",
  rep_first_name: "Svitlana",
  rep_last_name: "Testerova",
  rep_title: "Owner",
  rep_job_position: "CEO",
  rep_email: "owner@svitcleaning.example.com",
  rep_phone: "(813) 555-0100",
  support_phone: "",
  support_email: "",
  privacy_url: "",
  terms_url: "",
};
const regRow = async (org: string) =>
  (
    await api.sql<{ status: string; details: Record<string, string>; twilio: Record<string, string>; submitted_at: string | null; status_detail: string | null }>(
      "select status, details, twilio, submitted_at, status_detail from public.sms_registrations where organization_id = $1",
      [org],
    )
  )[0];

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("turning texting on and off", { timeout: 120_000 }, () => {
  it("on: a Canadian company gets its own number, its text automations switch on, and its plan gets the overage meter", async () => {
    const c = await company("CA");
    await subscribed(c);

    expect(await as(c.owner, () => sms.enableSmsAction({})), api.log()).toEqual({ success: true });
    const on = await orgSms(c.org);
    expect(on).toMatchObject({ sms_enabled: true, sms_from_number: "+15005550006", sms_number_sid: "SIMULATED", sms_overage_item_id: "si_test_1" });
    expect(on.automation_settings.booking_confirmation_sms).toEqual({ enabled: true, template: "kept" });
    expect(on.automation_settings.booking_reminder_client_sms?.enabled).toBe(true);
    expect(on.automation_settings.booking_assignment_sms?.enabled).toBe(true);
    expect(on.automation_settings.invoice_overdue_reminder, "other automations are left as they were").toEqual({ enabled: true });
    expect(stripeFake.calls).toEqual([{ method: "subscriptionItems.create", args: [{ subscription: `sub_sms_${seq}`, price: "price_test_sms_overage" }] }]);

    // Pressed again: the same number, the same meter.
    stripeFake.calls.length = 0;
    expect(await as(c.admin, () => sms.enableSmsAction({}))).toEqual({ success: true });
    expect(await orgSms(c.org)).toMatchObject({ sms_from_number: "+15005550006", sms_overage_item_id: "si_test_1" });
    expect(stripeFake.calls).toEqual([]);
    expect(outside, "nothing reached Twilio").toEqual([]);
  });

  it("off: texting stops and the meter comes off the plan, but the number is kept for next time", async () => {
    const c = await company("CA");
    await subscribed(c);
    await as(c.owner, () => sms.enableSmsAction({}));
    const itemId = (await orgSms(c.org)).sms_overage_item_id;
    stripeFake.calls.length = 0;

    expect(await as(c.owner, () => sms.disableSmsAction({}))).toEqual({ success: true });
    expect(await orgSms(c.org)).toMatchObject({ sms_enabled: false, sms_from_number: "+15005550006", sms_overage_item_id: null });
    expect(stripeFake.calls).toEqual([{ method: "subscriptionItems.del", args: [itemId, { clear_usage: true }] }]);
    const audits = await api.sql<{ after: Record<string, unknown> }>(
      "select after from public.audit_log where organization_id = $1 and entity = 'settings' order by created_at",
      [c.org],
    );
    expect(audits.map((a) => a.after.sms_enabled)).toEqual([true, false]);
  });

  it("a comped company texts without an overage meter; a lapsed one can't switch texting on", async () => {
    const comped = await company("CA", "Comped Co");
    await api.sql("update public.organizations set billing_override = 'comp' where id = $1", [comped.org]);
    await subscribed(comped);
    expect(await as(comped.owner, () => sms.enableSmsAction({}))).toEqual({ success: true });
    expect((await orgSms(comped.org)).sms_overage_item_id).toBeNull();
    expect(stripeFake.calls).toEqual([]);

    const lapsed = await company("CA", "Lapsed Co");
    await subscribed(lapsed, "canceled");
    expect(await as(lapsed.owner, () => sms.enableSmsAction({}))).toEqual({
      errors: { _form: "Your subscription is inactive. Start or renew a plan in Billing before enabling SMS." },
    });
    expect(await orgSms(lapsed.org)).toMatchObject({ sms_enabled: false, sms_from_number: null });
  });

  it("a US company is told to register first, and texting comes on once the carriers have approved it", async () => {
    const c = await company("US");
    expect(await as(c.owner, () => sms.enableSmsAction({}))).toEqual({
      errors: {
        _form:
          "US businesses register with the carriers before texting. Fill in the registration below; texting turns on by itself once it's approved.",
      },
    });
    expect(await orgSms(c.org), "no number bought before approval").toMatchObject({ sms_enabled: false, sms_from_number: null });

    await api.sql("insert into public.sms_registrations (organization_id, status) values ($1, 'approved')", [c.org]);
    await api.sql("update public.organizations set sms_from_number = '+18135550199', sms_number_sid = 'PN_TEST' where id = $1", [c.org]);
    expect(await as(c.owner, () => sms.enableSmsAction({}))).toEqual({ success: true });
    expect(await orgSms(c.org)).toMatchObject({ sms_enabled: true, sms_from_number: "+18135550199" });
  });

  it("a manager or cleaner can't turn texting on or off, or change the cap", async () => {
    const c = await company("CA");
    await api.sql("update public.organizations set sms_overage_cap_cents = 5000 where id = $1", [c.org]);
    const refused = { errors: { _form: "You don't have permission." } };
    for (const who of [c.manager, c.anna]) {
      expect(await as(who, () => sms.enableSmsAction({}))).toEqual(refused);
      expect(await as(who, () => sms.saveCapAction({}, form({ cap_dollars: "9999" })))).toEqual(refused);
    }
    expect(await orgSms(c.org)).toMatchObject({ sms_enabled: false, sms_from_number: null, sms_overage_cap_cents: 5000 });

    await as(c.owner, () => sms.enableSmsAction({}));
    for (const who of [c.manager, c.anna]) {
      expect(await as(who, () => sms.disableSmsAction({}))).toEqual(refused);
    }
    expect((await orgSms(c.org)).sms_enabled).toBe(true);
  });
});

describe.skipIf(!hasPostgrest)("the monthly overage cap", { timeout: 120_000 }, () => {
  it("saves dollars as cents for her own company, and refuses an amount that isn't one", async () => {
    const c = await company("CA");
    const other = await company("CA", "Other Cap Co");
    await api.sql("update public.organizations set sms_overage_cap_cents = 1234 where id = $1", [other.org]);

    expect(await as(c.owner, () => sms.saveCapAction({}, form({ cap_dollars: " 25.50 " })))).toEqual({ success: true });
    expect((await orgSms(c.org)).sms_overage_cap_cents).toBe(2550);
    expect(await as(c.admin, () => sms.saveCapAction({}, form({ cap_dollars: "0" })))).toEqual({ success: true });
    expect((await orgSms(c.org)).sms_overage_cap_cents).toBe(0);

    for (const bad of ["-1", "abc", "100000.01", "Infinity"]) {
      expect(await as(c.owner, () => sms.saveCapAction({}, form({ cap_dollars: bad }))), bad).toEqual({
        errors: { cap: "Enter a dollar amount between 0 and 100,000." },
      });
    }
    expect((await orgSms(c.org)).sms_overage_cap_cents).toBe(0);
    expect((await orgSms(other.org)).sms_overage_cap_cents, "another company's cap is untouched").toBe(1234);
  });

  it("a cleared cap field is refused, not saved as $0, which would stop every text past the allotment", async () => {
    const c = await company("CA");
    await api.sql("update public.organizations set sms_overage_cap_cents = 5000 where id = $1", [c.org]);
    for (const blank of ["", "   "]) {
      expect(await as(c.owner, () => sms.saveCapAction({}, form({ cap_dollars: blank }))), JSON.stringify(blank)).toEqual({
        errors: { cap: "Enter a dollar amount between 0 and 100,000." },
      });
    }
    expect((await orgSms(c.org)).sms_overage_cap_cents).toBe(5000);
  });
});

describe.skipIf(!hasPostgrest)("US texting registration", { timeout: 120_000 }, () => {
  it("saves the answers with the EIN encrypted, refuses a carrier-rejectable answer, and keeps the EIN when left blank", async () => {
    const c = await company("US");
    expect(await as(c.owner, () => registration.saveRegistrationAction({}, form(REG))), api.log()).toEqual({ saved: true });
    const saved = await regRow(c.org);
    expect(saved.status).toBe("draft");
    expect(saved.details).toMatchObject({ legal_name: "Svit Cleaning LLC", brand_name: "Svit Cleaning LLC", state: "FL", rep_phone: "+18135550100", ein_last4: "6789" });
    expect(JSON.stringify(saved.details), "the EIN is never stored in the clear").not.toContain("3456789");
    expect(maybeDecryptField(saved.details.ein_enc)).toBe("12-3456789");

    const bad = (await as(c.owner, () =>
      registration.saveRegistrationAction({}, form({ ...REG, legal_name: "Renamed LLC", rep_email: "svit@gmail.com", ein: "123" })),
    )) as { errors?: Record<string, string> };
    expect(Object.keys(bad.errors ?? {}).sort()).toEqual(["ein", "rep_email"]);
    expect((await regRow(c.org)).details.legal_name, "nothing saved from a refused form").toBe("Svit Cleaning LLC");

    expect(await as(c.admin, () => registration.saveRegistrationAction({}, form({ ...REG, ein: "", city: "Orlando" })))).toEqual({ saved: true });
    const again = await regRow(c.org);
    expect(again.details.city).toBe("Orlando");
    expect(maybeDecryptField(again.details.ein_enc), "the EIN on file is kept").toBe("12-3456789");
  });

  it("submitting sends it to the carriers (simulated here), after which it can't be edited underneath them", async () => {
    const c = await company("US");
    expect(await as(c.owner, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })))).toEqual({ submitted: true });
    const sent = await regRow(c.org);
    expect(sent.status).toBe("brand_review");
    expect(sent.twilio).toEqual({ simulated: "true" });
    expect(sent.submitted_at).not.toBeNull();
    expect(outside).toEqual([]);

    expect(await as(c.owner, () => registration.saveRegistrationAction({}, form({ ...REG, legal_name: "Too Late LLC" })))).toEqual({
      errors: { _form: "This registration is with the carriers now. It can be changed if they ask for changes." },
    });
    expect((await regRow(c.org)).details.legal_name).toBe("Svit Cleaning LLC");
  });

  it("a lapsed company can save but not submit (a brand registration costs money)", async () => {
    const c = await company("US");
    await subscribed(c, "canceled");
    expect(await as(c.owner, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })))).toEqual({
      errors: { _form: "Your subscription is inactive. Start or renew a plan in Billing first." },
    });
    expect(await regRow(c.org), "nothing saved by the refused submit").toBeUndefined();
    expect(await as(c.owner, () => registration.saveRegistrationAction({}, form(REG)))).toEqual({ saved: true });
    expect((await regRow(c.org)).status).toBe("draft");
  });

  it("only an owner or admin can save, submit or check it", async () => {
    const c = await company("US");
    for (const who of [c.manager, c.anna]) {
      expect(await as(who, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })))).toEqual({
        errors: { _form: "Only an owner or admin can register the business for texting." },
      });
    }
    expect(await regRow(c.org)).toBeUndefined();

    await as(c.owner, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })));
    for (const who of [c.manager, c.anna]) {
      expect(await as(who, () => registration.checkRegistrationAction())).toEqual({ ok: false, error: "Not allowed." });
    }
    expect((await regRow(c.org)).status).toBe("brand_review");
  });

  it("Check now moves it along one step per look, and on approval buys the number and turns texting on", async () => {
    const c = await company("US");
    await as(c.owner, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })));

    expect(await as(c.owner, () => registration.checkRegistrationAction())).toEqual({ ok: true });
    expect((await regRow(c.org)).status).toBe("campaign_review");
    expect((await orgSms(c.org)).sms_enabled).toBe(false);

    expect(await as(c.admin, () => registration.checkRegistrationAction())).toEqual({ ok: true });
    const done = await regRow(c.org);
    expect(done.status).toBe("approved");
    expect(done.status_detail).toBe("Your texting number is +15005550006.");
    expect(await orgSms(c.org)).toMatchObject({ sms_enabled: true, sms_from_number: "+15005550006" });

    // Approved is the end: a later look changes nothing.
    expect(await as(c.owner, () => registration.checkRegistrationAction())).toEqual({ ok: true });
    expect((await regRow(c.org)).status).toBe("approved");
    expect(outside).toEqual([]);
  });

  it("the hourly cron needs its secret, moves every waiting registration along, finishes a stuck submit, and leaves the rest alone", async () => {
    const cron = (auth?: string) =>
      registrationsCron(new NextRequest("http://localhost/api/cron/sms-registrations", { headers: auth ? { authorization: auth } : {} }));
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer not-the-secret-value")).status).toBe(401);

    const waiting = await company("US", "Waiting Co");
    await as(waiting.owner, () => registration.saveRegistrationAction({}, form({ ...REG, intent: "submit" })));
    const stuck = await company("US", "Stuck Co");
    await as(stuck.owner, () => registration.saveRegistrationAction({}, form(REG)));
    await api.sql("update public.sms_registrations set status = 'submitted', updated_at = now() - interval '20 minutes' where organization_id = $1", [stuck.org]);
    const draft = await company("US", "Draft Co");
    await as(draft.owner, () => registration.saveRegistrationAction({}, form(REG)));

    const res = await cron(`Bearer ${CRON_SECRET}`);
    await settle();
    expect(res.status, api.log()).toBe(200);
    const body = (await res.json()) as { checked: number; changed: number };
    expect(body.changed).toBeGreaterThanOrEqual(2);
    expect((await regRow(waiting.org)).status).toBe("campaign_review");
    expect((await regRow(stuck.org)).status, "the submit that was cut off is finished").toBe("brand_review");
    expect((await regRow(draft.org)).status, "a draft is the owner's, not the cron's").toBe("draft");
    expect(outside).toEqual([]);
  });
});
