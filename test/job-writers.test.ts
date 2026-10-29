/**
 * A booking writer without syncJob is a bug on sight.
 *
 * The job's state (src/lib/job-state.ts) is computed from a few facts:
 * bookings.status / scheduled_at / duration_minutes / closed_at /
 * divide_hours_evenly / the price fields, which booking_assignees rows exist
 * (and their split_*), and time_entries' employee / clock_in_at /
 * clock_out_at / booking_id. Every module that changes one of those facts
 * has to call syncJob afterwards (or closeJob, which does), or the stored
 * status and the manager's one-liner drift from what actually happened.
 * Oct 28: the office ended the last two shifts from Timesheets and the job
 * sat "in progress" for an hour because that path never told the rules.
 *
 * This test reads the source, finds every write to those three tables,
 * decides from the payload whether it touches a fact, and fails for any
 * module that does and never imports the recompute. A write whose payload
 * is a variable (not an object literal) is assumed to touch a fact — the
 * rule is conservative on purpose. Modules that genuinely must not
 * recompute go in ALLOWLIST with the reason; adding to it is a review
 * decision, not a reflex.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Modules that write a fact and must not recompute, with the reason. */
const ALLOWLIST: Record<string, string> = {};

const FACT_KEYS: Record<string, Set<string>> = {
  bookings: new Set([
    "status",
    "scheduled_at",
    "duration_minutes",
    "closed_at",
    "divide_hours_evenly",
    "total_cents",
    "hourly_rate_cents",
    "is_free",
  ]),
  booking_assignees: new Set([
    "membership_id",
    "booking_id",
    "split_start_offset_minutes",
    "split_duration_minutes",
  ]),
  time_entries: new Set(["employee_id", "clock_in_at", "clock_out_at", "booking_id"]),
};

/** Row existence is itself a fact for the roster and the shifts. */
const ROW_IS_FACT = new Set(["booking_assignees", "time_entries"]);

type Write = { file: string; line: number; table: string; verb: string; fact: boolean };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The argument text of a call that opens at `open` (index of "("). */
function argumentText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Does this payload touch a fact? Unknown shapes count as yes. */
function touchesFact(table: string, verb: string, payload: string): boolean {
  if (verb === "delete") return ROW_IS_FACT.has(table);
  if ((verb === "insert" || verb === "upsert") && (ROW_IS_FACT.has(table) || table === "bookings")) {
    return true;
  }
  const body = payload.trim();
  // Only an object literal can be read; a variable or a call is opaque.
  if (!body.startsWith("{") || body.includes("...")) return true;
  const keys = new Set<string>();
  for (const m of body.matchAll(/(?:^|[{,\s])([a-z_]+)\s*(?::|,|\})/g)) keys.add(m[1]);
  for (const k of keys) if (FACT_KEYS[table].has(k)) return true;
  return false;
}

function findWrites(file: string, src: string): Write[] {
  const out: Write[] = [];
  const fromRe = /\.from\(\s*"(bookings|booking_assignees|time_entries)"(?:\s+as\s+never)?\s*\)/g;
  for (const m of src.matchAll(fromRe)) {
    const start = m.index!;
    const end = src.indexOf(";", start);
    const chain = src.slice(start, end === -1 ? undefined : end);
    const verbMatch = chain.match(/\.(insert|update|upsert|delete)\s*\(/);
    if (!verbMatch) continue;
    const verb = verbMatch[1];
    const open = start + verbMatch.index! + verbMatch[0].length - 1;
    const payload = verb === "delete" ? "" : argumentText(src, open);
    out.push({
      file: relative(ROOT, file).replace(/\\/g, "/"),
      line: src.slice(0, start).split("\n").length,
      table: m[1],
      verb,
      fact: touchesFact(m[1], verb, payload),
    });
  }
  return out;
}

function recomputes(src: string): boolean {
  // The module that defines syncJob is the recompute; its own status write
  // is the one write that needs no further sync.
  if (/export async function syncJob\b/.test(src)) return true;
  return /lib\/job-sync"|lib\/close-job"/.test(src);
}

describe("every writer of a job fact recomputes the job", () => {
  const files = walk(SRC);
  const violations: string[] = [];
  let factWriters = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    const writes = findWrites(file, src).filter((w) => w.fact);
    if (writes.length === 0) continue;
    const rel = writes[0].file;
    factWriters++;
    if (recomputes(src) || ALLOWLIST[rel]) continue;
    for (const w of writes) {
      violations.push(`${w.file}:${w.line}  ${w.table}.${w.verb}()`);
    }
  }

  it("finds the writers at all (the scan is not silently empty)", () => {
    expect(factWriters).toBeGreaterThan(10);
  });

  it("has no writer that changes a fact without importing the recompute", () => {
    expect(
      violations,
      "\nThese modules change a fact the job rules read and never call syncJob.\n" +
        "Fix: import { syncJob } from \"@/lib/job-sync\" and call it with the booking id\n" +
        "after the write (one call per booking touched). If the module truly must\n" +
        "not recompute, add it to ALLOWLIST in test/job-writers.test.ts with why.\n",
    ).toEqual([]);
  });

  it("keeps the allowlist honest: every entry is a real fact writer", () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      const src = readFileSync(join(ROOT, rel), "utf-8");
      expect(findWrites(join(ROOT, rel), src).some((w) => w.fact), rel).toBe(true);
    }
  });
});

/**
 * A cleaner's clock-in keeps her tap time.
 *
 * The Sep 13 insert guard (time_entries_employee_insert_guard) rewrites
 * clock_in_at to now() for any non-manager writing through her own
 * client, so a tap queued in a dead zone and sent twenty minutes later
 * recorded her twenty minutes late. The service role is exempt, so every
 * clock-in the field app inserts must go through the admin client, after
 * the action's own checks. This keeps it that way.
 */
describe("the field app's clock-in inserts go through the admin client", () => {
  it("has no time_entries insert under src/app/field on the user client", () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC, "app", "field"))) {
      const src = readFileSync(file, "utf-8");
      const re = /\.from\(\s*"time_entries"(?:\s+as\s+never)?\s*\)/g;
      for (const m of src.matchAll(re)) {
        const start = m.index!;
        const end = src.indexOf(";", start);
        const chain = src.slice(start, end === -1 ? undefined : end);
        if (!/\.insert\s*\(/.test(chain)) continue;
        const before = src.slice(Math.max(0, start - 80), start);
        if (!/admin|createSupabaseAdminClient\(\)/.test(before)) {
          offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${src.slice(0, start).split("\n").length}`);
        }
      }
    }
    expect(offenders, "clock-in inserts on the user client (the guard will overwrite clock_in_at)").toEqual([]);
  });
});
