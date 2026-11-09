/**
 * Every entry point runs fail-closed.
 *
 * supabase/query-guard.ts makes a query whose error was dropped throw instead
 * of continuing — but only inside a scope somebody entered. Crons enter it in
 * requireCronAuth, the public API in authenticateApiKey, office actions in
 * getActionContext. Everything that authenticates its own way — webhooks with
 * a signature, token pages, the client portal, sign-up — had to remember on
 * its own, and sixteen files hadn't: 39 reads whose error went nowhere, some
 * ahead of a payment stamp or a cancellation. This test reads the source and
 * fails for any route handler or server-action module that reaches none of
 * the entry points. Exemptions go in ALLOWLIST with the reason; adding one is
 * a review decision, not a reflex.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Any of these, called, puts the rest of the request inside the scope. */
const ENTRY_POINTS =
  /\b(authenticateApiKey|requireCronAuth|getActionContext|requireActionMembership|requireClientAction|enterFailClosed|runFailClosed)\s*\(/;

const ALLOWLIST: Record<string, string> = {
  "src/app/api/version/route.ts": "reads an env var; no database",
  "src/app/api/places-autocomplete/route.ts":
    "proxies Google Places for a signed-in user; reads nothing from the database",
  "src/app/api/u/g/[token]/route.ts":
    "RFC 8058 one-click unsubscribe must answer 200 whatever happens; a thrown read would 500 and cost sender reputation",
  "src/app/api/u/m/[token]/route.ts": "same one-click unsubscribe contract",
  "src/app/api/u/p/[token]/route.ts": "same one-click unsubscribe contract",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");

/** A module-level "use server" directive: the file's first statement. */
function isActionModule(src: string): boolean {
  const head = src.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^\s*["']use server["']\s*;?/.test(head);
}

describe("every entry point runs fail-closed", () => {
  const files = walk(join(SRC, "app"));
  const entryFiles = files.filter((f) => {
    if (/[\\/]route\.ts$/.test(f)) return true;
    return isActionModule(readFileSync(f, "utf8"));
  });

  it("finds the entry points at all (the scan is not silently empty)", () => {
    expect(entryFiles.length).toBeGreaterThan(80);
  });

  it("has no route handler or action module outside the scope", () => {
    const missing: string[] = [];
    for (const f of entryFiles) {
      const r = rel(f);
      if (ALLOWLIST[r]) continue;
      if (!ENTRY_POINTS.test(readFileSync(f, "utf8"))) missing.push(r);
    }
    expect(
      missing,
      "\nThese files answer requests and never enter the fail-closed scope.\n" +
        "Fix: authenticate through getActionContext() / requireActionMembership() /\n" +
        "requireClientAction() / authenticateApiKey() / requireCronAuth(), or call\n" +
        "enterFailClosed() right after the signature or token check, before the first\n" +
        "await. If the file truly must not, add it to ALLOWLIST with the reason.\n",
    ).toEqual([]);
  });

  it("keeps the allowlist honest: every entry is a real entry point without the scope", () => {
    for (const r of Object.keys(ALLOWLIST)) {
      const src = readFileSync(join(ROOT, r), "utf8");
      expect(entryFiles.map(rel)).toContain(r);
      expect(ENTRY_POINTS.test(src), `${r} now enters the scope; drop it from ALLOWLIST`).toBe(false);
    }
  });

  it("pages keep requireMembership, which stays fail-open on purpose", () => {
    // The action variants exist so the page one never has to change: a read
    // that fails on a page renders less; in an action it must stop the write.
    const auth = readFileSync(join(SRC, "lib", "auth.ts"), "utf8");
    expect(auth).toMatch(/export async function requireActionMembership\(/);
    expect(auth).toMatch(/export async function requireMembership\(/);
  });
});
