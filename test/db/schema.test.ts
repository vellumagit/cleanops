/**
 * Invariants of the schema as a whole, read from the real catalog.
 *
 * The first test is the one that pays every day: opening the database applies
 * every migration from zero, so a migration that cannot run fails here before
 * it is pasted into the SQL editor.
 *
 * The lists pinned below are review gates, like the allowlists in
 * test/job-writers.test.ts. A change to one is meant to be a decision someone
 * made, not something a migration did in passing.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationFiles, openDb } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const names = async (sql: string): Promise<string[]> =>
  (await db.query<{ name: string }>(sql)).rows.map((r) => r.name);

describe("migrations", () => {
  it("apply from zero, in filename order", async () => {
    const tables = await names(
      "select tablename as name from pg_tables where schemaname = 'public'",
    );
    expect(tables.length).toBeGreaterThan(80);
    expect(tables).toContain("bookings");
    expect(tables).toContain("time_entries");
  });

  /**
   * Two files sharing a version is how the 2026-11-07 collision happened:
   * the SQL editor doesn't care, but anything that tracks versions applies
   * one and skips the other. The one pair below predates this test.
   */
  it("no two share a version", () => {
    const KNOWN = new Set(["20260820010000"]);
    const seen = new Map<string, string[]>();
    for (const f of migrationFiles()) {
      const v = f.split("_")[0];
      seen.set(v, [...(seen.get(v) ?? []), f]);
    }
    const clashes = [...seen].filter(([v, fs]) => fs.length > 1 && !KNOWN.has(v));
    expect(clashes, `rename one of: ${JSON.stringify(clashes)}`).toEqual([]);
  });
});

describe("row-level security", () => {
  it("is on for every table in public", async () => {
    const off = await names(`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`);
    expect(off, "enable row level security on these tables").toEqual([]);
  });

  /**
   * RLS on with no policy means only the service role can touch the table.
   * That is right for these and wrong by accident for anything else: a new
   * table that lands here either needs policies or belongs on this list.
   */
  it("only the known service-only tables have no policy", async () => {
    const SERVICE_ONLY = [
      "api_keys",
      // Public blog pages read it on the server; Holo's webhook writes it (2026-11-13).
      "blog_posts",
      "changelog_entries",
      "cron_runs",
      "email_suppressions",
      "org_email_counters",
      "promo_codes",
      "promo_redemptions",
      "quickbooks_oauth_states",
      "sage_oauth_states",
      "square_oauth_states",
      "stripe_events",
      "stripe_oauth_states",
    ];
    const bare = await names(`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and not exists (
          select from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
        )
      order by 1`);
    expect(bare).toEqual(SERVICE_ONLY);
  });
});

describe("functions that run with the owner's rights", () => {
  // SECURITY DEFINER skips RLS. A trigger function can't be called through
  // the API, so only the callable ones are a door.
  const callableBy = (role: string) => `
    select p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('${role}', p.oid, 'execute')
    order by 1`;

  /**
   * The policy helpers. RLS calls them as the querying role, two policies
   * that use them apply to every role, and each answers only about
   * auth.uid(), which a caller with no session doesn't have.
   */
  const POLICY_HELPERS = [
    "current_user_has_role",
    "current_user_membership_ids",
    "current_user_org_ids",
    "current_user_thread_ids",
    "is_booking_crew",
  ];

  /**
   * On Supabase "revoke ... from public" closes nothing: the platform grants
   * EXECUTE to anon and authenticated by name. Seven functions sat open to
   * the public key that way until 2026-11-10 (migration 20261110010000). A
   * name appearing here means a migration made the same mistake: revoke from
   * public, anon, authenticated.
   */
  it("only the policy helpers can be called without signing in", async () => {
    expect(await names(callableBy("anon"))).toEqual(POLICY_HELPERS);
  });

  /**
   * Each of these answers only about the caller, or checks the caller's
   * role first. A new name here is a function any signed-in user of any org
   * can call with the owner's rights: read it for a missing membership check
   * before adding it.
   */
  it("a signed-in user can call only the reviewed ones", async () => {
    expect(await names(callableBy("authenticated"))).toEqual(
      [
        // Checks the caller is an owner or admin of the org it is asked about.
        "booking_schedule_has_conflict",
        // Keyed on the caller's own memberships.
        "chat_mark_thread_read",
        "chat_unread_threads",
        "chat_unread_total",
        ...POLICY_HELPERS,
      ].sort(),
    );
  });
});
