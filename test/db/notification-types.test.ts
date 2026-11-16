/**
 * The notification types the app may send are exactly the ones the
 * database accepts. notify() only takes a NotificationType, so a value
 * missing from src/lib/notification-types.ts is a build error; this keeps
 * that list equal to the enum the migrations build, so a value cannot be
 * on the list without a migration behind it (the "billing" bug: refund and
 * voided-payment notices failed silently for three months).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";
import { openDb } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await openDb();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

describe("notification types", () => {
  it("the list notify() accepts is the enum the migrations build, value for value", async () => {
    const { rows } = await db.query<{ v: string }>("select unnest(enum_range(null::public.notification_type))::text as v");
    expect([...NOTIFICATION_TYPES].sort()).toEqual(rows.map((r) => r.v).sort());
  });
});
