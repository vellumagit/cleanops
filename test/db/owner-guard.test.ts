/**
 * The owner guard on memberships, after pay_type was dropped (2026-11-11).
 *
 * memberships_owner_guard compared pay_type on self-edits. Migration
 * 20261111020000 rewrites it without that comparison, then drops the column.
 * Had the drop come without the rewrite, an admin editing their own
 * membership would fail with 42703 (checked by removing the rewrite). These
 * run as signed-in users against the real policies and trigger, with every
 * migration applied.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, addOrg, openDb, refusal, scenario } from "./harness";

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("membership edits with pay_type gone", () => {
  it("the column is gone", async () => {
    await scenario(db, async (w) => {
      const cols = await w.seed<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'memberships' and column_name = 'pay_type'",
      );
      expect(cols).toEqual([]);
    });
  });

  it("an owner still edits a cleaner's rate and name", async () => {
    await scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const owner = await addMember(w.seed, org, "owner");
      const cleaner = await addMember(w.seed, org, "employee");
      await w.as(owner.userId)(
        "update public.memberships set pay_rate_cents = 2300, display_name = 'Olha M' where id = $1",
        [cleaner.membershipId],
      );
      const [row] = await w.seed<{ pay_rate_cents: number; display_name: string }>(
        "select pay_rate_cents, display_name from public.memberships where id = $1",
        [cleaner.membershipId],
      );
      expect(row).toEqual({ pay_rate_cents: 2300, display_name: "Olha M" });
    });
  });

  // Only owners and admins can update memberships at all (RLS), so the
  // self-edit rule is about admins.
  it("an admin still edits a cleaner, and still cannot raise their own pay or change their own role", async () => {
    await scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      await addMember(w.seed, org, "owner");
      const admin = await addMember(w.seed, org, "admin");
      const cleaner = await addMember(w.seed, org, "employee");
      const me = w.as(admin.userId);

      await me("update public.memberships set pay_rate_cents = 2100 where id = $1", [cleaner.membershipId]);
      expect(
        (await w.seed<{ pay_rate_cents: number }>("select pay_rate_cents from public.memberships where id = $1", [cleaner.membershipId]))[0],
      ).toEqual({ pay_rate_cents: 2100 });

      expect(
        await refusal(me("update public.memberships set pay_rate_cents = 9999 where id = $1", [admin.membershipId])),
      ).toBe("42501");
      expect(
        await refusal(me("update public.memberships set role = 'owner' where id = $1", [admin.membershipId])),
      ).toBe("42501");
      // Their own name is fine.
      await me("update public.memberships set display_name = 'Ada' where id = $1", [admin.membershipId]);
    });
  });

  it("an admin still cannot change an owner's pay", async () => {
    await scenario(db, async (w) => {
      const org = await addOrg(w.seed);
      const owner = await addMember(w.seed, org, "owner");
      const admin = await addMember(w.seed, org, "admin");
      expect(
        await refusal(
          w.as(admin.userId)("update public.memberships set pay_rate_cents = 1 where id = $1", [owner.membershipId]),
        ),
      ).toBe("42501");
    });
  });
});
