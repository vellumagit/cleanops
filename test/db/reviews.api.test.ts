/**
 * A review link cannot be made from what a member can read.
 *
 * Review bonuses pay money, and until 2026-11-10 the review page accepted
 * whoever presented the value in bookings.review_token, a column every
 * member of the company can read through the API. These run the real public
 * submit action against the real database, with a cleaner reading what she
 * is allowed to read through her own session and trying to use it.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasPostgrest, startApi, type Api } from "./api";
import { addBooking, addClient, addMember, addOrg, MIGRATIONS_DIR, type Member } from "./harness";

vi.mock("next/headers", async () => (await import("./next-stubs")).nextHeaders());
vi.mock("next/cache", async () => (await import("./next-stubs")).nextCache());
vi.mock("next/navigation", async () => (await import("./next-stubs")).nextNavigation());
vi.mock("next/server", async () => (await import("./next-stubs")).nextServer());

let api: Api;
let restoreEnv: () => void;
let submit: typeof import("@/app/review/[token]/actions").submitReviewAction;
let tokens: typeof import("@/lib/review-token");

beforeAll(async () => {
  if (!hasPostgrest) return;
  api = await startApi();
  restoreEnv = api.useAsSupabase();
  ({ submitReviewAction: submit } = await import("@/app/review/[token]/actions"));
  tokens = await import("@/lib/review-token");
}, 240_000);

afterAll(async () => {
  restoreEnv?.();
  await api?.stop();
});

type Scene = { org: string; client: string; anna: Member; job: string };

/** A finished job with Anna on it, for a client who has not reviewed anyone yet. */
async function finishedJob(): Promise<Scene> {
  const org = await addOrg(api.sql, "Company");
  const client = await addClient(api.sql, org);
  const anna = await addMember(api.sql, org, "employee", "Anna");
  const job = await addBooking(api.sql, org, client, {
    scheduledAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    status: "completed",
  });
  await api.sql("update public.bookings set assigned_to = $2 where id = $1", [job, anna.membershipId]);
  await api.sql(
    "insert into public.booking_assignees (organization_id, booking_id, membership_id, is_primary) values ($1, $2, $3, true)",
    [org, job, anna.membershipId],
  );
  return { org, client, anna, job };
}

async function send(token: string, source: "booking" | "invoice", sourceId: string, rating = 5) {
  const form = new FormData();
  form.set("token", token);
  form.set("source", source);
  form.set("sourceId", sourceId);
  form.set("rating", String(rating));
  form.set("comment", "Spotless.");
  return submit({ success: false, error: null }, form);
}

const reviewsFor = (job: string) =>
  api.sql<{ rating: number; employee_id: string | null }>(
    "select rating, employee_id from public.reviews where booking_id = $1",
    [job],
  );

/** What Anna's own session returns for a column of her own job. */
async function asAnnaRead(s: Scene, column: string): Promise<unknown> {
  const hers = createClient(api.url, api.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${api.tokenFor(s.anna.userId)}` } },
  });
  const { data, error } = await hers.from("bookings").select(column).eq("id", s.job).maybeSingle();
  expect(error, api.log()).toBeNull();
  return (data as Record<string, unknown> | null)?.[column] ?? null;
}

describe.skipIf(!hasPostgrest)("review links", { timeout: 90_000 }, () => {
  it("the signed link the client is sent works, once, and credits the cleaner on the job", async () => {
    const s = await finishedJob();
    const link = tokens.reviewLinkToken("booking", s.job);
    expect(await send(link, "booking", s.job), api.log()).toEqual({ success: true, error: null });
    expect(await reviewsFor(s.job)).toEqual([{ rating: 5, employee_id: s.anna.membershipId }]);
    // The same client cannot stack reviews.
    expect((await send(link, "booking", s.job)).success).toBe(false);
    expect(await reviewsFor(s.job)).toHaveLength(1);
  });

  /**
   * The hole, closed. After a link is issued the column holds a marker, and
   * Anna can read it: reading is not the problem. Using it is.
   */
  it("a cleaner can read her job's review column and it gets her nothing", async () => {
    const s = await finishedJob();
    await api.sql("update public.bookings set review_token = $2 where id = $1", [
      s.job,
      tokens.storedReviewToken(tokens.reviewLinkToken("booking", s.job)),
    ]);
    const whatSheSees = String(await asAnnaRead(s, "review_token"));
    expect(whatSheSees).toMatch(/^sha256:/);

    expect((await send(whatSheSees, "booking", s.job)).success).toBe(false);
    // Nor does stripping the prefix, or guessing at a signed shape from the id she also knows.
    expect((await send(whatSheSees.slice("sha256:".length), "booking", s.job)).success).toBe(false);
    expect((await send(`r1.b.${s.job}.${whatSheSees.slice(7, 39)}`, "booking", s.job)).success).toBe(false);
    expect(await reviewsFor(s.job)).toEqual([]);
  });

  it("a signed link is for one job: it does not open another, and an edited one opens nothing", async () => {
    const a = await finishedJob();
    const b = await finishedJob();
    const linkA = tokens.reviewLinkToken("booking", a.job);
    expect((await send(linkA, "booking", b.job)).success).toBe(false);
    expect((await send(linkA.slice(0, -2) + "zz", "booking", a.job)).success).toBe(false);
    expect((await send(linkA, "invoice", a.job)).success).toBe(false);
    expect(await reviewsFor(a.job)).toEqual([]);
    expect(await reviewsFor(b.job)).toEqual([]);
  });

  /**
   * Links already in clients' inboxes are random tokens the database used to
   * hold as plain text. Migration 20261110050000 replaces each with its hash.
   */
  it("a link emailed before today keeps working after the migration; the hash left behind does not", async () => {
    const before = await finishedJob();
    const after = await finishedJob();
    const emailedBefore = "k3J9xQp2LmN8vR4tAbCd";
    const emailedAfter = "Zy8wVu7TsR6qPo5NmLkJ";
    await api.sql("update public.bookings set review_token = $2 where id = $1", [before.job, emailedBefore]);
    await api.sql("update public.bookings set review_token = $2 where id = $1", [after.job, emailedAfter]);

    // Between the deploy and the migration the column is still plain text.
    expect(await send(emailedBefore, "booking", before.job), api.log()).toEqual({ success: true, error: null });

    // The migration, as written.
    const migration = readFileSync(join(MIGRATIONS_DIR, "20261110050000_review_tokens_hashed_at_rest.sql"), "utf8")
      .replace(/^\s*--.*$/gm, "");
    for (const statement of migration.split(";").map((x) => x.trim()).filter(Boolean)) await api.sql(statement);

    const stored = String(await asAnnaRead(after, "review_token"));
    expect(stored).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored).not.toContain(emailedAfter);
    expect((await send(stored, "booking", after.job)).success).toBe(false);
    expect(await send(emailedAfter, "booking", after.job), api.log()).toEqual({ success: true, error: null });
    expect(await reviewsFor(after.job)).toHaveLength(1);

    // Running it again changes nothing.
    for (const statement of migration.split(";").map((x) => x.trim()).filter(Boolean)) await api.sql(statement);
    expect(String(await asAnnaRead(after, "review_token"))).toBe(stored);
  });

  it("an invoice's review link works the same way", async () => {
    const s = await finishedJob();
    const [inv] = await api.sql<{ id: string }>(
      `insert into public.invoices (organization_id, client_id, booking_id, status, amount_cents, paid_at)
       values ($1, $2, $3, 'paid', 14000, now()) returning id`,
      [s.org, s.client, s.job],
    );
    expect((await send(tokens.reviewLinkToken("booking", inv.id), "invoice", inv.id)).success).toBe(false);
    expect(await send(tokens.reviewLinkToken("invoice", inv.id), "invoice", inv.id), api.log()).toEqual({
      success: true,
      error: null,
    });
    expect(await reviewsFor(s.job)).toEqual([{ rating: 5, employee_id: s.anna.membershipId }]);
  });

  it("the existing rules still hold: no review of a job that is not finished", async () => {
    const s = await finishedJob();
    await api.sql("update public.bookings set status = 'confirmed' where id = $1", [s.job]);
    const res = await send(tokens.reviewLinkToken("booking", s.job), "booking", s.job);
    expect(res.success).toBe(false);
    expect(await reviewsFor(s.job)).toEqual([]);
  });
});
