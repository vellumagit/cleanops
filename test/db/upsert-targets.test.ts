/**
 * Every upsert names a conflict target the database can actually use.
 *
 * `.upsert(row, { onConflict: "email" })` becomes ON CONFLICT (email), and
 * Postgres accepts that only when a unique index covers exactly those
 * columns, with no expression and no WHERE. Otherwise the statement fails
 * with 42P10 every time it runs. email_suppressions had an index on
 * lower(email) from 2026-06-02 to 2026-11-09: no bounce or complaint was
 * ever recorded, and nothing said so until fail-closed turned the swallowed
 * error into a Sentry event.
 *
 * Source is scanned for the targets; the catalog of the migrated database
 * answers whether each one exists.
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./harness";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

let db: PGlite;
beforeAll(async () => {
  db = await openDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

type Target = { table: string; columns: string[]; file: string };

/** `.from("t") … onConflict: "a,b"` within one statement's reach. */
function upsertTargets(): Target[] {
  const found: Target[] = [];
  const pattern = /from\(\s*"([a-z_]+)"(?:\s+as\s+never)?\s*\)[\s\S]{0,600}?onConflict:\s*"([^"]+)"/g;
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) {
      // The nearest from() before this onConflict, not one from an earlier query.
      const chunk = m[0];
      const last = [...chunk.matchAll(/from\(\s*"([a-z_]+)"/g)].pop();
      found.push({
        table: last ? last[1] : m[1],
        columns: m[2].split(",").map((c) => c.trim()).sort(),
        file: relative(SRC, file).replace(/\\/g, "/"),
      });
    }
  }
  return found;
}

describe("upsert conflict targets", () => {
  it("each has a plain unique index on exactly its columns", async () => {
    const targets = upsertTargets();
    // If the scan finds nothing the test proves nothing.
    expect(targets.length).toBeGreaterThan(5);

    const { rows } = await db.query<{ tbl: string; cols: string[] }>(`
      select c.relname as tbl,
             (select array_agg(a.attname::text order by a.attname)
                from unnest(i.indkey::int2[]) k(attnum)
                join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum) as cols
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and i.indisunique
        and i.indpred is null     -- a partial index can't be inferred without its WHERE
        and i.indexprs is null    -- nor an expression index from bare column names
    `);
    const usable = new Set(rows.map((r) => `${r.tbl}(${r.cols.join(",")})`));

    const missing = targets
      .filter((t) => !usable.has(`${t.table}(${t.columns.join(",")})`))
      .map((t) => `${t.table}(${t.columns.join(",")}) in src/${t.file}`);
    expect(
      missing,
      "these upserts fail with 42P10 on every call: add a plain unique index on the columns, or name a target that has one",
    ).toEqual([]);
    // Reads every source file; slow when the whole suite runs beside it.
  }, 30_000);
});
