/**
 * Every query the app writes names things the database has.
 *
 * The client is untyped for most of the schema (`as never` is everywhere), so
 * nothing at compile time knows whether a column exists. PostgREST finds out
 * at run time, and until fail-closed arrived most callers threw the error
 * away: flat-rate clients were never invoiced because an insert named
 * invoices.notes before the column existed (PGRST204), and a second foreign
 * key between two tables turns every unhinted embed of them into an error
 * (PGRST201) the day it is added.
 *
 * This reads each `.from("table")` chain out of src and asks the catalog of
 * the migrated database: does the table exist, do the selected, filtered and
 * written columns exist, and does each embedded relation resolve to exactly
 * one foreign key? It also checks each `.rpc()` names a real function with
 * real parameter names.
 *
 * A column that exists in production but not here means a migration file is
 * missing: the schema was changed by hand and never written down.
 */
import type { PGlite } from "@electric-sql/pglite";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "./harness";
import {
  literal,
  objectKeys,
  parseSelect,
  scanFile,
  skipBalanced,
  sourceFiles,
  splitTopLevel,
  type Chain,
  type SelectItem,
} from "./query-scan";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

type ForeignKey = { name: string; from: string; to: string; cols: string[] };
type Catalog = {
  columns: Map<string, Set<string>>;
  views: Set<string>;
  fks: ForeignKey[];
  pks: Map<string, Set<string>>;
  functions: Map<string, string[][]>;
};

let db: PGlite;
let catalog: Catalog;

beforeAll(async () => {
  db = await openDb();
  const cols = await db.query<{ t: string; c: string }>(
    "select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'",
  );
  const columns = new Map<string, Set<string>>();
  for (const r of cols.rows) {
    if (!columns.has(r.t)) columns.set(r.t, new Set());
    columns.get(r.t)!.add(r.c);
  }
  const views = await db.query<{ t: string }>(
    "select table_name as t from information_schema.views where table_schema = 'public'",
  );
  const fks = await db.query<ForeignKey>(`
    select con.conname::text as name, src.relname::text as "from", dst.relname::text as "to",
           (select array_agg(a.attname::text order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_namespace sn on sn.oid = src.relnamespace
    join pg_class dst on dst.oid = con.confrelid
    join pg_namespace dn on dn.oid = dst.relnamespace
    where con.contype = 'f' and sn.nspname = 'public' and dn.nspname = 'public'`);
  const pkRows = await db.query<{ t: string; c: string }>(`
    select c.relname::text as t, a.attname::text as c
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and n.nspname = 'public'`);
  const pks = new Map<string, Set<string>>();
  for (const r of pkRows.rows) {
    if (!pks.has(r.t)) pks.set(r.t, new Set());
    pks.get(r.t)!.add(r.c);
  }
  const fnRows = await db.query<{ name: string; args: string[] }>(`
    select p.proname::text as name,
           array(select p.proargnames[i]
                 from generate_subscripts(p.proargnames, 1) i
                 where p.proargmodes is null or p.proargmodes[i] in ('i', 'b', 'v')) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'`);
  const functions = new Map<string, string[][]>();
  for (const r of fnRows.rows) functions.set(r.name, [...(functions.get(r.name) ?? []), r.args ?? []]);
  catalog = {
    columns,
    views: new Set(views.rows.map((r) => r.t)),
    fks: fks.rows,
    pks,
    functions,
  };
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** Foreign keys linking two tables, in either direction. */
function directLinks(a: string, b: string): ForeignKey[] {
  return catalog.fks.filter((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a));
}

/** Junction tables PostgREST would join through: both keys inside the junction's primary key. */
function junctions(a: string, b: string): string[] {
  const out: string[] = [];
  for (const j of catalog.columns.keys()) {
    if (j === a || j === b) continue;
    const pk = catalog.pks.get(j) ?? new Set();
    const toA = catalog.fks.filter((f) => f.from === j && f.to === a && f.cols.every((c) => pk.has(c)));
    const toB = catalog.fks.filter((f) => f.from === j && f.to === b && f.cols.every((c) => pk.has(c)));
    if (toA.length > 0 && toB.length > 0) out.push(j);
  }
  return out;
}

function checkItems(table: string, items: SelectItem[], problems: string[]): void {
  const cols = catalog.columns.get(table);
  if (!cols) return;
  for (const item of items) {
    if (item.kind === "star") continue;
    if (item.kind === "column") {
      if (!cols.has(item.name)) problems.push(`${table}.${item.name} does not exist`);
      continue;
    }
    let target = item.target;
    if (!catalog.columns.has(target)) {
      // The embed can name the foreign key, or the column carrying it.
      const viaKey = catalog.fks.find(
        (f) =>
          (f.from === table && (f.name === target || (f.cols.length === 1 && f.cols[0] === target))) ||
          (f.to === table && f.name === target),
      );
      if (!viaKey) {
        problems.push(`${table} embeds "${target}", which is not a table, a foreign key or a key column`);
        continue;
      }
      target = viaKey.from === table ? viaKey.to : viaKey.from;
    } else if (!catalog.views.has(table) && !catalog.views.has(target)) {
      const links = directLinks(table, target);
      if (item.hint) {
        const hint = item.hint;
        const hit =
          links.some((f) => f.name === hint || (f.cols.length === 1 && f.cols[0] === hint)) ||
          junctions(table, target).includes(hint);
        if (!hit) {
          problems.push(
            `${table} embeds ${target}!${hint}, but no foreign key between them has that name or column (there: ${links.map((f) => f.name).join(", ") || "none"})`,
          );
        }
      } else if (links.length > 1) {
        problems.push(
          `${table} embeds ${target} with no hint, and ${links.length} foreign keys link them (${links.map((f) => f.name).join(", ")}): PostgREST refuses with PGRST201. Name one: ${target}!<foreign key>`,
        );
      } else if (links.length === 0) {
        const via = junctions(table, target);
        if (via.length === 0) problems.push(`${table} embeds ${target}, and no foreign key links them`);
        else if (via.length > 1) {
          problems.push(`${table} embeds ${target} through ${via.length} junction tables (${via.join(", ")}): name one`);
        }
      }
    }
    checkItems(target, item.items, problems);
  }
}

const FILTERS = new Set([
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
  "contains", "containedBy", "overlaps", "order", "not", "filter",
]);
const WRITES = new Set(["insert", "update", "upsert"]);

function checkChain(chain: Chain): string[] {
  const problems: string[] = [];
  const cols = catalog.columns.get(chain.table);
  if (!cols) return [`table "${chain.table}" does not exist`];
  for (const call of chain.calls) {
    const args = splitTopLevel(call.args);
    if (call.method === "select") {
      const text = args.length === 0 ? "*" : literal(args[0]);
      if (text == null) continue; // built at run time
      try {
        checkItems(chain.table, parseSelect(text), problems);
      } catch (err) {
        problems.push(`select could not be read: ${(err as Error).message}`);
      }
    } else if (FILTERS.has(call.method)) {
      const col = literal(args[0]);
      if (col == null || col.includes(".")) continue; // dynamic, or a filter on an embedded table
      if (/referencedTable|foreignTable/.test(call.args)) continue;
      const root = col.split("->")[0].trim();
      if (!cols.has(root)) problems.push(`.${call.method}("${col}"): ${chain.table}.${root} does not exist`);
    } else if (WRITES.has(call.method)) {
      for (const key of objectKeys(args[0]) ?? []) {
        if (!cols.has(key)) problems.push(`.${call.method}() writes ${chain.table}.${key}, which does not exist`);
      }
    } else if (call.method === "match") {
      for (const key of objectKeys(args[0]) ?? []) {
        if (!cols.has(key)) problems.push(`.match() filters ${chain.table}.${key}, which does not exist`);
      }
    }
  }
  return problems;
}

describe("queries in src, against the real schema", () => {
  it("every table, column and embedded relation exists", () => {
    const report: string[] = [];
    let chains = 0;
    let selects = 0;
    for (const file of sourceFiles(SRC)) {
      const display = `src/${relative(SRC, file).replace(/\\/g, "/")}`;
      for (const chain of scanFile(file, display)) {
        chains++;
        selects += chain.calls.filter((c) => c.method === "select").length;
        for (const p of checkChain(chain)) report.push(`${chain.file}:${chain.line}  ${p}`);
      }
    }
    // A scan that finds nothing proves nothing.
    expect(chains).toBeGreaterThan(500);
    expect(selects).toBeGreaterThan(400);
    expect(report, `${report.length} query problem(s)`).toEqual([]);
  }, 60_000);

  it("every rpc() names a real function and real parameters", () => {
    const report: string[] = [];
    let calls = 0;
    for (const file of sourceFiles(SRC)) {
      const display = `src/${relative(SRC, file).replace(/\\/g, "/")}`;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\.rpc\(/g)) {
        const open = (m.index ?? 0) + m[0].length - 1;
        const args = splitTopLevel(text.slice(open + 1, skipBalanced(text, open) - 1));
        const name = literal(args[0]);
        if (name == null) continue;
        calls++;
        const overloads = catalog.functions.get(name);
        const line = text.slice(0, open).split("\n").length;
        if (!overloads) {
          report.push(`${display}:${line}  rpc("${name}"): no such function`);
          continue;
        }
        const keys = objectKeys(args[1]);
        if (!keys) continue;
        if (!overloads.some((params) => keys.every((k) => params.includes(k)))) {
          report.push(
            `${display}:${line}  rpc("${name}") passes ${keys.join(", ")}; the function takes ${overloads.map((p) => p.join(", ")).join(" | ")}`,
          );
        }
      }
    }
    expect(calls).toBeGreaterThan(5);
    expect(report).toEqual([]);
  }, 60_000);
});
