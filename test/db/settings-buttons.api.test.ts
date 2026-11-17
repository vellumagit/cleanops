/**
 * The settings Svit has changed, saved the way the owner saves them,
 * against a real database behind the real PostgREST. From its audit log:
 * invoice auto-send, payment and tipping instructions, branding, contact
 * details, tax and currency, and the automation switches (those flip
 * without an audit row; Svit's company has 45 of them set).
 *
 * The switches used to lose a change: each read the whole settings object
 * and wrote it all back, so two flipped close together both started from
 * the same copy and the second undid the first. Tipping settings, saved
 * from two screens into one column, had the same shape.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  ...(await import("./next-stubs")).nextServer(),
}));

let api: Api;
let restoreEnv: () => void;
let savedKey: string | undefined;

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  savedKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}, 240_000);

afterAll(async () => {
  if (savedKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = savedKey;
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
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
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) f.append(k, x);
    else f.set(k, v);
  }
  return f;
};

type Company = { org: string; owner: Member; manager: Member };
async function company(): Promise<Company> {
  const org = await addOrg(api.sql, "Settings Co");
  await api.sql(
    `update public.organizations set timezone = 'America/Regina', automations_enabled = true,
       automation_settings = '{"shift_clock_out_reminder":{"enabled":true,"grace_minutes":60,"reminder_interval_minutes":15},"invoice_overdue_reminder":{"enabled":true},"weekly_ops_digest":{"enabled":false}}'::jsonb
     where id = $1`,
    [org],
  );
  return { org, owner: await addMember(api.sql, org, "owner", "Svitlana"), manager: await addMember(api.sql, org, "manager", "Office") };
}
const settings = async (org: string) =>
  (await api.sql<{ s: Record<string, Record<string, unknown>>; master: boolean }>(
    "select automation_settings as s, automations_enabled as master from public.organizations where id = $1",
    [org],
  ))[0];

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("the automation switches", { timeout: 120_000 }, () => {
  it("two switches flipped at the same moment both stay where they were put, and neither loses its settings", async () => {
    const { toggleAutomationAction } = await import("@/app/app/settings/automations/actions");
    const c = await company();

    await Promise.all([
      as(c.owner, () => toggleAutomationAction(form({ key: "invoice_overdue_reminder", enabled: "false" }))),
      as(c.owner, () => toggleAutomationAction(form({ key: "weekly_ops_digest", enabled: "true" }))),
      as(c.owner, () => toggleAutomationAction(form({ key: "shift_clock_out_reminder", enabled: "false" }))),
    ]);
    const { s } = await settings(c.org);
    expect(s.invoice_overdue_reminder, api.log().slice(-300)).toEqual({ enabled: false });
    expect(s.weekly_ops_digest).toEqual({ enabled: true });
    // Its thresholds ride along with the switch.
    expect(s.shift_clock_out_reminder).toEqual({ enabled: false, grace_minutes: 60, reminder_interval_minutes: 15 });
  });

  it("the master switch, the house default, a preset, thresholds and cadence each save; a manager changes none of them", async () => {
    const {
      toggleAutomationsMasterAction,
      setOrgContactDefaultAction,
      applyAutomationPresetAction,
      updateClockOutThresholdsAction,
      setAutomationFrequencyAction,
      toggleAutomationAction,
    } = await import("@/app/app/settings/automations/actions");
    const c = await company();

    await as(c.owner, () => toggleAutomationsMasterAction(form({ enabled: "false" })));
    expect((await settings(c.org)).master).toBe(false);
    await as(c.owner, () => setOrgContactDefaultAction(form({ default_contact_preference: "none" })));
    await as(c.owner, () => setOrgContactDefaultAction(form({ default_contact_preference: "carrier pigeon" })));
    expect((await api.sql<{ d: string }>("select default_contact_preference as d from public.organizations where id = $1", [c.org]))[0].d).toBe("none");

    // A preset turns its switches on and the master with them, without
    // resetting anything already configured.
    await as(c.owner, () => applyAutomationPresetAction(form({ preset: "essentials" })));
    const afterPreset = await settings(c.org);
    expect(afterPreset.master).toBe(true);
    expect(afterPreset.s.shift_clock_out_reminder).toMatchObject({ grace_minutes: 60, reminder_interval_minutes: 15 });

    expect(await as(c.owner, () => updateClockOutThresholdsAction(form({ grace_minutes: "90", reminder_interval_minutes: "30" })))).toEqual({ ok: true });
    expect((await settings(c.org)).s.shift_clock_out_reminder).toMatchObject({ grace_minutes: 90, reminder_interval_minutes: 30 });

    await as(c.owner, () => setAutomationFrequencyAction(form({ key: "rebooking_prompt_email", frequency: "yearly" })));
    expect((await settings(c.org)).s.rebooking_prompt_email).toMatchObject({ frequency: "yearly" });

    const before = await settings(c.org);
    await as(c.manager, () => toggleAutomationAction(form({ key: "weekly_ops_digest", enabled: "true" })));
    await as(c.manager, () => toggleAutomationsMasterAction(form({ enabled: "false" })));
    expect(await as(c.manager, () => updateClockOutThresholdsAction(form({ grace_minutes: "5", reminder_interval_minutes: "5" })))).toEqual({
      ok: false,
      error: "You don't have permission to change this.",
    });
    expect(await settings(c.org)).toEqual(before);
  });
});

describe.skipIf(!hasPostgrest)("invoicing and payment settings", { timeout: 120_000 }, () => {
  it("auto-send saves its time and rhythm; a blank time is refused instead of becoming midnight", async () => {
    const { saveInvoiceAutoSendAction } = await import("@/app/app/settings/invoicing/actions");
    const c = await company();
    expect(await as(c.owner, () => saveInvoiceAutoSendAction({}, form({ enabled: "on", send_hour: "9", send_mode: "next_day", consolidated: "on" })))).toMatchObject({
      success: true,
    });
    const [row] = await api.sql<{ on: boolean; hour: number; mode: string; cons: boolean }>(
      `select invoice_auto_send_enabled as on, invoice_auto_send_hour as hour, invoice_auto_send_mode as mode,
              invoice_auto_send_consolidated as cons from public.organizations where id = $1`,
      [c.org],
    );
    expect(row).toEqual({ on: true, hour: 9, mode: "next_day", cons: true });
    expect(await as(c.owner, () => saveInvoiceAutoSendAction({}, form({ enabled: "on", send_hour: "" })))).toEqual({ errors: { hour: "Pick a time of day." } });
    expect((await api.sql<{ hour: number }>("select invoice_auto_send_hour as hour from public.organizations where id = $1", [c.org]))[0].hour).toBe(9);
    expect(await as(c.manager, () => saveInvoiceAutoSendAction({}, form({ enabled: "", send_hour: "3" })))).toEqual({ errors: { _form: "You don't have permission." } });
  });

  it("tipping on/off and tipping wording, saved from their two screens at once, both stay", async () => {
    const { saveTippingAction } = await import("@/app/app/settings/invoicing/actions");
    const { saveTipInstructionsAction } = await import("@/app/app/settings/payment-methods/actions");
    const c = await company();
    await Promise.all([
      as(c.owner, () => saveTippingAction({}, form({ enabled: "on", presets: ["10", "15", "20"] }))),
      as(c.owner, () => saveTipInstructionsAction({}, form({ instructions: "Tips go straight to your cleaner. Thank you!" }))),
    ]);
    const [{ t }] = await api.sql<{ t: Record<string, unknown> }>("select tipping_settings as t from public.organizations where id = $1", [c.org]);
    expect(t, api.log().slice(-300)).toMatchObject({ enabled: true, presets: [10, 15, 20], instructions: "Tips go straight to your cleaner. Thank you!" });
  });

  it("payment instructions are stored encrypted and read back as typed", async () => {
    const { savePaymentInstructionsAction } = await import("@/app/app/settings/payment-methods/actions");
    const { maybeDecryptField } = await import("@/lib/field-encryption");
    const c = await company();
    const text = "E-transfer to payments@example.test. Cheques to Svit Company Inc.";
    const res = (await as(c.owner, () => savePaymentInstructionsAction({}, form({ instructions: text })))) as { errors?: unknown };
    expect(res.errors, JSON.stringify(res)).toBeUndefined();
    const [{ v }] = await api.sql<{ v: string }>("select default_payment_instructions as v from public.organizations where id = $1", [c.org]);
    expect(v).not.toContain("payments@example.test");
    expect(maybeDecryptField(v)).toBe(text);
  });
});

describe.skipIf(!hasPostgrest)("company details", { timeout: 120_000 }, () => {
  it("branding, contact details, tax, currency, time zone and thresholds save; bad values are refused in words and change nothing", async () => {
    const { saveBrandingAction } = await import("@/app/app/settings/branding/actions");
    const { saveContactInfoAction } = await import("@/app/app/settings/email/actions");
    const { saveTaxDefaultsAction, saveCurrencyAction } = await import("@/app/app/settings/currency/actions");
    const { updateOrgTimezoneAction } = await import("@/app/app/settings/timezone/actions");
    const { updateThresholdsAction } = await import("@/app/app/settings/thresholds/actions");
    const c = await company();
    const org = async () =>
      (await api.sql<Record<string, unknown>>(
        `select brand_color, google_review_url, contact_email, contact_phone, default_tax_rate_bps, default_tax_label,
                currency_code, timezone, archive_after_days, overtime_threshold_hours, booking_auto_complete_hours
           from public.organizations where id = $1`,
        [c.org],
      ))[0];

    expect(await as(c.owner, () => saveBrandingAction({}, form({ brand_color: "#4f46e5", google_review_url: "https://g.page/r/svit/review" })))).toMatchObject({
      success: true,
    });
    expect(((await as(c.owner, () => saveBrandingAction({}, form({ brand_color: "purple" })))) as { errors?: Record<string, string> }).errors?.brand_color).toBeTruthy();

    expect(await as(c.owner, () => saveContactInfoAction({}, form({ contact_email: "hello@svit.example", contact_phone: "+1 587 555 0199" })))).toEqual({ success: true });
    expect(((await as(c.owner, () => saveContactInfoAction({}, form({ contact_email: "not an email", contact_phone: "" })))) as { errors?: Record<string, string> }).errors).toBeTruthy();

    expect(await as(c.owner, () => saveTaxDefaultsAction({}, form({ tax_rate: "5", tax_label: "GST" })))).toMatchObject({ success: true });
    expect(await as(c.owner, () => saveTaxDefaultsAction({}, form({ tax_rate: "150", tax_label: "Silly" })))).toEqual({ errors: { tax_rate: "Rate can't exceed 99.99%." } });
    expect(await as(c.owner, () => saveCurrencyAction({}, form({ currency_code: "cad" })))).toMatchObject({ success: true });

    expect(await as(c.owner, () => updateOrgTimezoneAction({}, form({ timezone: "America/Edmonton" })))).toEqual({ ok: true });
    expect(await as(c.owner, () => updateOrgTimezoneAction({}, form({ timezone: "Mars/Olympus_Mons" })))).toMatchObject({ error: expect.stringContaining("isn't a recognized") });

    expect(
      await as(c.owner, () =>
        updateThresholdsAction({}, form({ stale_estimate_expire_days: "30", invoice_void_days: "", booking_auto_complete_hours: "4", archive_after_days: "730", overtime_threshold_hours: "40" })),
      ),
    ).toEqual({ ok: true });
    expect(
      await as(c.owner, () =>
        updateThresholdsAction({}, form({ stale_estimate_expire_days: "30", invoice_void_days: "", booking_auto_complete_hours: "4", archive_after_days: "90", overtime_threshold_hours: "40" })),
      ),
    ).toMatchObject({ error: expect.stringContaining("invalid") });

    expect(await org()).toEqual({
      brand_color: "4f46e5",
      google_review_url: "https://g.page/r/svit/review",
      contact_email: "hello@svit.example",
      contact_phone: "+1 587 555 0199",
      default_tax_rate_bps: 500,
      default_tax_label: "GST",
      currency_code: "CAD",
      timezone: "America/Edmonton",
      archive_after_days: 730,
      overtime_threshold_hours: "40.00",
      booking_auto_complete_hours: 4,
    });

    // A manager is told no, or sent back, and nothing moves.
    const before = await org();
    await as(c.manager, () => saveTaxDefaultsAction({}, form({ tax_rate: "13", tax_label: "HST" })));
    await as(c.manager, () => updateOrgTimezoneAction({}, form({ timezone: "America/Toronto" })));
    expect(await org()).toEqual(before);
  });
});
