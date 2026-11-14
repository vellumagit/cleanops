/**
 * Plan tiers: how many cleaners each plan holds, and how many texts it
 * includes, run through the real actions against the real database behind
 * the real PostgREST (test/db/api.ts).
 *
 * The rules (decided 2026-11-14, src/lib/plan-limits.ts):
 *   - Starter 3, Team 10, Growth 25 cleaners; Enterprise unlimited.
 *   - A cleaner is an ACTIVE member with role employee. Office roles don't count.
 *   - Comped companies (billing_override, e.g. from a discount code) are
 *     exempt; so are legacy companies, and everyone while billing is off.
 *   - Nobody already working is ever touched: a company over its limit
 *     keeps everyone and can still edit them; it just can't add more.
 *   - Texts per month: 300 / 750 / 1,500 / 5,000.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addMember, addOrg, type Member } from "./harness";
import { request, settle } from "./next-stubs";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let employees: typeof import("@/app/app/employees/actions");
let billing: typeof import("@/app/app/settings/billing/actions");
let claim: typeof import("@/lib/invitation-claim");
let sms: typeof import("@/lib/sms");
let admin: typeof import("@/lib/supabase/admin");

const ENV_KEYS = ["STRIPE_ENABLED", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_TEAM", "STRIPE_PRICE_GROWTH"] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(async () => {
  if (!hasPostgrest) return;
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.STRIPE_ENABLED = "true";
  process.env.STRIPE_PRICE_STARTER = "price_test_starter";
  process.env.STRIPE_PRICE_TEAM = "price_test_team";
  process.env.STRIPE_PRICE_GROWTH = "price_test_growth";
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  employees = await import("@/app/app/employees/actions");
  billing = await import("@/app/app/settings/billing/actions");
  claim = await import("@/lib/invitation-claim");
  sms = await import("@/lib/sms");
  admin = await import("@/lib/supabase/admin");
}, 240_000);

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  restoreEnv?.();
  await api?.stop();
});

beforeEach(() => {
  request.cookies = [];
  request.after = [];
  process.env.STRIPE_ENABLED = "true";
});

// ---------------------------------------------------------------------------

async function as<T>(who: Member, act: () => Promise<T>): Promise<T> {
  request.cookies = api.sessionCookies(who.userId);
  try {
    return await act();
  } finally {
    await settle();
  }
}

type Company = { org: string; owner: Member };
type Billing =
  | { plan: "starter" | "team" | "growth" | "enterprise"; byPriceOnly?: boolean }
  | "trial"
  | "legacy";

/** A company on a paid plan (active Stripe subscription), on its trial, or legacy. */
async function company(billingState: Billing): Promise<Company> {
  const org = await addOrg(api.sql, "Company");
  const owner = await addMember(api.sql, org, "owner", "Owner");
  if (billingState === "trial") {
    await api.sql("update public.organizations set trial_started_at = now() where id = $1", [org]);
  } else if (billingState === "legacy") {
    await api.sql("update public.organizations set trial_started_at = null where id = $1", [org]);
  } else {
    await api.sql(
      `insert into public.subscriptions (organization_id, stripe_subscription_id, stripe_price_id, status, plan_tier)
       values ($1, $2, $3, 'active', $4)`,
      [
        org,
        `sub_${org}`,
        `price_test_${billingState.plan}`,
        billingState.byPriceOnly ? null : billingState.plan,
      ],
    );
  }
  return { org, owner };
}

function manualForm(name: string, role = "employee"): FormData {
  const form = new FormData();
  form.set("display_name", name);
  form.set("role", role);
  form.set("engagement", "employee");
  return form;
}

/** The owner adds someone by hand (Employees → Add manually). */
const addByHand = (c: Company, name: string, role = "employee") =>
  as(c.owner, () => employees.createManualEmployeeAction({}, manualForm(name, role)));

/** Straight into the database, the way a company that predates limits got its crew. */
async function seedCleaners(c: Company, n: number, status: "active" | "disabled" = "active") {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await addMember(api.sql, c.org, "employee", "Cleaner", status)).membershipId);
  return ids;
}

const activeCleaners = async (org: string) =>
  Number(
    (
      await api.sql<{ n: string }>(
        "select count(*)::text as n from public.memberships where organization_id = $1 and role = 'employee' and status = 'active'",
        [org],
      )
    )[0].n,
  );

// ---------------------------------------------------------------------------

describe.skipIf(!hasPostgrest)("cleaner limits", () => {
  it("Starter takes 3 cleaners; the 4th is refused with a plain message, not a crash", async () => {
    const c = await company({ plan: "starter" });
    for (const name of ["Ana", "Ben", "Cleo"]) {
      expect(await addByHand(c, name)).toEqual({ done: true });
    }

    const fourth = await addByHand(c, "Dee");
    expect(fourth.done).toBeUndefined();
    expect(fourth.errors?._form).toMatch(/The Starter plan includes up to 3 cleaners, and you have 3 active/);
    expect(fourth.errors?._form).toMatch(/Settings → Billing/);
    expect(await activeCleaners(c.org)).toBe(3);

    // The office never counts: an admin still goes in at the limit.
    expect(await addByHand(c, "Office", "admin")).toEqual({ done: true });
  });

  it("Team takes 10 and refuses the 11th", async () => {
    const c = await company({ plan: "team" });
    await seedCleaners(c, 9);
    expect(await addByHand(c, "Tenth")).toEqual({ done: true });
    expect(await activeCleaners(c.org)).toBe(10);

    const eleventh = await addByHand(c, "Eleventh");
    expect(eleventh.errors?._form).toMatch(/The Team plan includes up to 10 cleaners/);
    expect(await activeCleaners(c.org)).toBe(10);
  });

  it("reads the plan from the Stripe price when plan_tier wasn't stored", async () => {
    const c = await company({ plan: "starter", byPriceOnly: true });
    await seedCleaners(c, 3);
    expect((await addByHand(c, "Fourth")).errors?._form).toMatch(/Starter plan includes up to 3/);
  });

  it("Growth takes 25; Enterprise has no limit", async () => {
    const growth = await company({ plan: "growth" });
    await seedCleaners(growth, 25);
    expect((await addByHand(growth, "Twenty-sixth")).errors?._form).toMatch(/Growth plan includes up to 25/);

    const enterprise = await company({ plan: "enterprise" });
    await seedCleaners(enterprise, 30);
    expect(await addByHand(enterprise, "Thirty-first")).toEqual({ done: true });
  });

  it("a comped company is exempt, including one comped by redeeming a discount code", async () => {
    // Comped directly, the way Velluma's and Svit's companies are.
    const comped = await company({ plan: "starter" });
    await api.sql("update public.organizations set billing_override = 'comp' where id = $1", [comped.org]);
    await seedCleaners(comped, 3);
    expect(await addByHand(comped, "Fourth")).toEqual({ done: true });

    // At the limit, then a discount code lifts it.
    const c = await company({ plan: "starter" });
    await seedCleaners(c, 3);
    expect((await addByHand(c, "Before code")).errors?._form).toMatch(/Starter plan/);
    await api.sql(
      "insert into public.promo_codes (code, kind, max_redemptions) values ($1, 'free_forever', 5)",
      [`FRIEND-${c.org.slice(0, 8)}`.toUpperCase()],
    );
    const form = new FormData();
    form.set("code", `FRIEND-${c.org.slice(0, 8)}`);
    expect(await as(c.owner, () => billing.redeemPromoCodeAction(form))).toEqual({ ok: true, kind: "free_forever" });
    expect(await addByHand(c, "After code")).toEqual({ done: true });
  });

  it("a trial gets Growth's 25; a legacy company and billing-off are unlimited", async () => {
    const trial = await company("trial");
    await seedCleaners(trial, 24);
    expect(await addByHand(trial, "Twenty-fifth")).toEqual({ done: true });
    expect((await addByHand(trial, "Twenty-sixth")).errors?._form).toMatch(/free trial includes up to 25/);

    const legacy = await company("legacy");
    await seedCleaners(legacy, 30);
    expect(await addByHand(legacy, "Thirty-first")).toEqual({ done: true });

    const starter = await company({ plan: "starter" });
    await seedCleaners(starter, 3);
    process.env.STRIPE_ENABLED = "false";
    expect(await addByHand(starter, "Fourth")).toEqual({ done: true });
  });

  it("an invite counts open invites, so ten can't be sent at 2 of 3", async () => {
    const c = await company({ plan: "starter" });
    await seedCleaners(c, 2);
    const invite = (email: string, role = "employee") => {
      const form = new FormData();
      form.set("name", "New hire");
      form.set("email", email);
      form.set("role", role);
      form.set("engagement", "employee");
      return as(c.owner, () => employees.sendInvitationAction({}, form));
    };

    const first = await invite(`first-${c.org}@example.test`);
    expect(first.errors).toBeUndefined();
    const second = await invite(`second-${c.org}@example.test`);
    expect(second.errors?._form).toMatch(/Starter plan includes up to 3 cleaners, and you have 3 active or invited/);

    // Inviting office staff isn't limited.
    expect((await invite(`office-${c.org}@example.test`, "admin")).errors).toBeUndefined();
  });

  it("accepting an invite past the limit is refused for the invitee, and no membership is made", async () => {
    const c = await company({ plan: "starter" });
    await seedCleaners(c, 3);
    const [invitation] = await api.sql<{ id: string }>(
      `insert into public.invitations (organization_id, email, role) values ($1, $2, 'employee') returning id`,
      [c.org, `late-${c.org}@example.test`],
    );
    const [user] = await api.sql<{ id: string }>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, '{}'::jsonb) returning id",
      [`late-${c.org}@example.test`],
    );

    const outcome = await claim.claimInvitation(
      admin.createSupabaseAdminClient(),
      {
        id: invitation.id,
        organization_id: c.org,
        email: `late-${c.org}@example.test`,
        role: "employee",
        engagement: null,
        pay_rate_cents: null,
      },
      user.id,
    );
    expect(outcome).toMatchObject({ ok: false, code: "cleaner_limit" });
    expect(!outcome.ok && outcome.error).toMatch(/Ask the person who invited you/);
    const rows = await api.sql("select 1 from public.memberships where profile_id = $1", [user.id]);
    expect(rows).toHaveLength(0);
    const [inv] = await api.sql<{ accepted: boolean }>(
      "select accepted_at is not null as accepted from public.invitations where id = $1",
      [invitation.id],
    );
    expect(inv.accepted).toBe(false);
  });

  it("over the limit, nobody is touched: edits and deactivations work, reactivating does not", async () => {
    // Five cleaners from before limits existed, now on Starter.
    const c = await company({ plan: "starter" });
    const [first, second] = await seedCleaners(c, 5);
    const [gone] = await seedCleaners(c, 1, "disabled");
    expect(await activeCleaners(c.org)).toBe(5);

    const update = (id: string, fields: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      return as(c.owner, () => employees.updateMemberAction(id, {}, form));
    };

    expect((await update(first, { contact_phone: "+15555550100" })).errors).toBeUndefined();
    expect((await update(second, { status: "disabled" })).errors).toBeUndefined();
    expect(await activeCleaners(c.org)).toBe(4);

    const back = await update(gone, { status: "active" });
    expect(back.errors?._form).toMatch(/Starter plan includes up to 3 cleaners, and you have 4 active/);
    expect(await activeCleaners(c.org)).toBe(4);
  });
});

describe.skipIf(!hasPostgrest)("texts included per plan", () => {
  it("Starter 300, Team 750, Growth 1,500, Enterprise 5,000; trial gets Starter's", async () => {
    const included = async (b: Billing) => (await sms.getOrgSmsUsage((await company(b)).org)).includedSegments;
    expect(await included({ plan: "starter" })).toBe(300);
    expect(await included({ plan: "team" })).toBe(750);
    expect(await included({ plan: "growth" })).toBe(1500);
    expect(await included({ plan: "enterprise" })).toBe(5000);
    expect(await included("trial")).toBe(300);
  });

  it("a comped company keeps the comp ceiling, not its plan's allowance", async () => {
    const c = await company({ plan: "starter" });
    await api.sql("update public.organizations set billing_override = 'comp' where id = $1", [c.org]);
    const usage = await sms.getOrgSmsUsage(c.org);
    expect(usage.isComped).toBe(true);
    expect(usage.includedSegments).toBe(sms.COMP_SAFETY_CAP_SEGMENTS);
  });
});
