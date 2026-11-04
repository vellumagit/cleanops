/**
 * bookings has two links to memberships: assigned_to, and closed_by since
 * migration 20261028010000. A select that embeds `memberships ( … )` off a
 * booking without naming the link is ambiguous, and PostgREST answers
 * PGRST201 instead of rows. That silently emptied the org-calendar reconcile,
 * the Restore button's calendar push and the in-app calendar page for four
 * days. Every embed off bookings must say which link it means.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The text inside the balanced parentheses that open at `open`. */
function inside(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

/** Every `.select(…)` in the file, with the table of the nearest `.from("…")` before it. */
function selects(text: string): Array<{ table: string; body: string; line: number }> {
  const out: Array<{ table: string; body: string; line: number }> = [];
  const from = /\.from\(\s*"([a-z_]+)"/g;
  const froms: Array<{ at: number; table: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = from.exec(text))) froms.push({ at: m.index, table: m[1] });
  let at = text.indexOf(".select(");
  while (at !== -1) {
    const before = froms.filter((f) => f.at < at).pop();
    if (before) {
      out.push({
        table: before.table,
        body: inside(text, at + ".select".length),
        line: text.slice(0, at).split("\n").length,
      });
    }
    at = text.indexOf(".select(", at + 1);
  }
  return out;
}

describe("embeds of memberships off bookings", () => {
  it("always name the link (memberships!bookings_<column>_fkey)", () => {
    const src = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of sourceFiles(src)) {
      const text = readFileSync(file, "utf8");
      for (const s of selects(text)) {
        if (s.table !== "bookings") continue;
        if (/\bmemberships\s*\(/.test(s.body) && !/memberships!bookings_[a-z_]+_fkey/.test(s.body)) {
          offenders.push(`${relative(src, file)}:${s.line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000); // walks every source file; slow under a full parallel run

  it("would have caught the bare embed", () => {
    const text = `admin.from("bookings").select(\`id, client:clients ( name ),
       assignee:memberships ( display_name, profile:profiles ( full_name ) )\`).eq("id", id)`;
    const [s] = selects(text);
    expect(s.table).toBe("bookings");
    expect(s.body).toContain("assignee:memberships (");
  });
});
