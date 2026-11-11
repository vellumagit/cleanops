/**
 * Reads the app's Supabase queries out of source text.
 *
 * Not a TypeScript parser: it finds `.from("table")`, walks the chained
 * method calls that follow, and hands back each call's raw arguments. That is
 * enough to know which table a query names, which columns it selects, filters
 * and writes, and which related tables it embeds. Anything built at runtime
 * (a template with ${}, a variable) is skipped rather than guessed at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type Call = { method: string; args: string };
export type Chain = { file: string; line: number; table: string; calls: Call[] };

export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Index just past whitespace and comments. */
function skipTrivia(s: string, i: number): number {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.startsWith("//", i)) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl + 1;
    } else if (s.startsWith("/*", i)) {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 2;
    } else return i;
  }
}

/** With s[i] an opening quote, the index just past its closing quote. */
function skipString(s: string, i: number): number {
  const quote = s[i];
  i++;
  while (i < s.length) {
    if (s[i] === "\\") i += 2;
    else if (quote === "`" && s.startsWith("${", i)) i = skipBalanced(s, i + 1);
    else if (s[i] === quote) return i + 1;
    else i++;
  }
  return i;
}

/** With s[i] an opening bracket, the index just past its match. */
export function skipBalanced(s: string, i: number): number {
  const open = s[i];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(s, i);
      continue;
    }
    if (s.startsWith("//", i) || s.startsWith("/*", i)) {
      i = skipTrivia(s, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** Top-level comma split of an argument list (or of a select string). */
export function splitTopLevel(s: string, separator = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") i = skipString(s, i);
    else if (ch === "(" || ch === "[" || ch === "{") i = skipBalanced(s, i);
    else if (ch === separator) {
      parts.push(s.slice(start, i));
      start = ++i;
    } else i++;
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * The value of a plain string literal argument, or null when the argument is
 * anything else. `"x" as never` and backticks without ${} count as plain.
 */
export function literal(arg: string | undefined): string | null {
  if (!arg) return null;
  const a = arg.trim();
  const quote = a[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  const end = skipString(a, 0);
  const rest = a.slice(end).trim();
  if (rest !== "" && !/^as\s+(never|const|string)$/.test(rest)) return null;
  const body = a.slice(1, end - 1);
  if (quote === "`" && body.includes("${")) return null;
  return body;
}

/**
 * Top-level keys of an object literal argument (`{ a: 1, b, "c": 2 }`), or
 * null when the argument isn't one or spreads something we can't see into.
 * For an array of objects, the first element's keys.
 */
export function objectKeys(arg: string | undefined): string[] | null {
  if (!arg) return null;
  let a = arg.trim().replace(/\s+as\s+never$/, "").trim();
  if (a.startsWith("[")) {
    const first = splitTopLevel(a.slice(1, skipBalanced(a, 0) - 1))[0];
    if (!first) return null;
    a = first.replace(/\s+as\s+never$/, "").trim();
  }
  if (!a.startsWith("{")) return null;
  const end = skipBalanced(a, 0);
  if (a.slice(end).trim() !== "") return null;
  const keys: string[] = [];
  for (const part of splitTopLevel(a.slice(1, end - 1))) {
    if (part.startsWith("...")) return null; // spread: the real keys are elsewhere
    if (part.startsWith("[")) return null; // computed key
    const m = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(part);
    if (!m) return null;
    keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

const NOT_A_CLIENT = /(Buffer|Array|Object|Uint8Array|Set|Map|storage)\s*$/;

export function scanFile(file: string, display: string): Chain[] {
  const s = readFileSync(file, "utf8");
  const chains: Chain[] = [];
  const from = /\.from\(\s*(["'`])([a-z_][a-z0-9_]*)\1(?:\s+as\s+never)?\s*\)/g;
  for (const m of s.matchAll(from)) {
    const at = m.index ?? 0;
    if (NOT_A_CLIENT.test(s.slice(Math.max(0, at - 12), at))) continue;
    // An example inside a comment is not a query.
    const lineStart = s.lastIndexOf("\n", at) + 1;
    if (/^\s*(\*|\/\/|\/\*)/.test(s.slice(lineStart, at))) continue;
    const calls: Call[] = [];
    let i = at + m[0].length;
    for (;;) {
      const j = skipTrivia(s, i);
      if (s[j] !== ".") break;
      const name = /^[A-Za-z_]\w*/.exec(s.slice(j + 1));
      if (!name) break;
      const k = skipTrivia(s, j + 1 + name[0].length);
      if (s[k] !== "(") break;
      const end = skipBalanced(s, k);
      calls.push({ method: name[0], args: s.slice(k + 1, end - 1) });
      i = end;
    }
    chains.push({
      file: display,
      line: s.slice(0, at).split("\n").length,
      table: m[2],
      calls,
    });
  }
  return chains;
}

// ---------------------------------------------------------------------------
// PostgREST select strings
// ---------------------------------------------------------------------------

export type SelectItem =
  | { kind: "star" }
  | { kind: "column"; name: string }
  | { kind: "embed"; target: string; hint: string | null; items: SelectItem[] };

/**
 * `id, client:clients!fk_name!inner ( name, address ), total::text`
 * Throws on text it can't read, so an unreadable select is reported rather
 * than silently passed.
 */
export function parseSelect(select: string): SelectItem[] {
  const items: SelectItem[] = [];
  for (const raw of splitTopLevel(select)) {
    let part = raw;
    if (part === "*") {
      items.push({ kind: "star" });
      continue;
    }
    if (part.startsWith("...")) part = part.slice(3).trim();
    const paren = part.indexOf("(");
    if (paren >= 0) {
      const close = skipBalanced(part, paren);
      if (part.slice(close).trim() !== "") throw new Error(`text after ")" in "${raw}"`);
      let head = part.slice(0, paren).trim();
      const colon = head.indexOf(":");
      if (colon >= 0) head = head.slice(colon + 1).trim(); // drop the alias
      const [target, ...marks] = head.split("!").map((x) => x.trim());
      if (!/^[a-z_][a-z0-9_]*$/.test(target)) throw new Error(`can't read the relation in "${raw}"`);
      const hint = marks.find((x) => x !== "inner" && x !== "left") ?? null;
      const inner = part.slice(paren + 1, close - 1).trim();
      items.push({ kind: "embed", target, hint, items: inner === "" ? [{ kind: "star" }] : parseSelect(inner) });
      continue;
    }
    // alias:column::cast, column->json->>path
    let col = part;
    const colon = col.search(/(?<!:):(?!:)/);
    if (colon >= 0) col = col.slice(colon + 1).trim();
    col = col.split("::")[0].split("->")[0].trim();
    if (col === "count") continue; // PostgREST's row count pseudo-column
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`can't read the column in "${raw}"`);
    items.push({ kind: "column", name: col });
  }
  return items;
}
