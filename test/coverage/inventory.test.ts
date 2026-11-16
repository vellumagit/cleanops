/**
 * Nothing ships untested, and the list of what is untested only shrinks.
 *
 * "No stone unturned" needs a list of stones. This walks the source for
 * every server action (an exported async function in a "use server" file),
 * every API route and every page, and asks of each: does any test name it?
 *
 *   - a server action is covered when its name appears in a unit, database
 *     or browser test;
 *   - an API route, when a test imports it or calls its path;
 *   - a page, when a browser test visits it.
 *
 * "Named in a test" is a floor, not a proof: a test can mention a thing
 * without checking much. It is the floor because it is mechanical, and
 * because the opposite (a feature no test even mentions) is what let a
 * crash screen sit in front of Olha for five days.
 *
 * The things with no test today are written down in untested.json. Two
 * rules keep that list honest:
 *
 *   1. A page, route or action that is not covered and not on the list
 *      fails here: it is new, and it needs a test (or, if it truly cannot
 *      have one, a line in untested.json that says so in the commit).
 *   2. Something on the list that is now covered, or no longer exists,
 *      fails here too: take it off. The list can only get shorter.
 *
 * After adding tests:  UPDATE_COVERAGE=1 npx vitest run test/coverage
 * rewrites untested.json to match; read the diff before committing it.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const LIST = join(__dirname, "untested.json");
const SELF = join(__dirname, "inventory.test.ts");

const slash = (p: string) => p.replace(/\\/g, "/");
const rel = (p: string) => slash(p.slice(ROOT.length + 1));

function walk(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------- tests ----

const isTest = (p: string) => /\.(test|spec)\.tsx?$/.test(p) && p !== SELF;
const testFiles = [...walk(join(ROOT, "src"), isTest), ...walk(join(ROOT, "test"), isTest)];
const allTests = testFiles.map(read).join("\n");
const browserTests = walk(join(ROOT, "test", "browser"), (p) => /\.spec\.tsx?$/.test(p)).map(read).join("\n");

// ------------------------------------------------------------- inventory ----

type Inventory = { actions: string[]; routes: string[]; pages: string[] };

/** "app/invoices/actions.ts#createInvoiceAction" for every server action. */
function serverActions(): string[] {
  const found: string[] = [];
  const sources = walk(join(ROOT, "src"), (p) => /\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p));
  for (const file of sources) {
    const text = read(file);
    if (!/^\s*["']use server["']/m.test(text)) continue;
    for (const m of text.matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_]+)/gm)) {
      found.push(`${rel(file).replace(/^src\//, "")}#${m[1]}`);
    }
  }
  return found.sort();
}

/** "api/cron/billing-cycle" for every route handler. */
function apiRoutes(): string[] {
  return walk(join(ROOT, "src", "app", "api"), (p) => /route\.ts$/.test(p))
    .map((f) => rel(f).replace(/^src\/app\//, "").replace(/\/route\.ts$/, ""))
    .sort();
}

const DYNAMIC = /\[\.\.\.[^\]]+\]|\[[^\]]+\]/g;

/** "/app/invoices/[id]/edit" for every page; route groups like (marketing) are not part of the URL. */
function pages(): string[] {
  return walk(join(ROOT, "src", "app"), (p) => /page\.tsx$/.test(p))
    .map((f) => {
      const path = rel(f)
        .replace(/^src\/app/, "")
        .replace(/\/page\.tsx$/, "")
        .split("/")
        .filter((seg) => !/^\(.*\)$/.test(seg))
        .join("/");
      return (path || "/").replace(DYNAMIC, "[id]");
    })
    .sort();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function actionCovered(key: string): boolean {
  const name = key.slice(key.indexOf("#") + 1);
  return new RegExp(`\\b${escapeRe(name)}\\b`).test(allTests);
}

function routeCovered(route: string): boolean {
  if (allTests.includes(`@/app/${route}/route`)) return true;
  const dynamic = route.indexOf("[");
  // A dynamic route is called with a real id in the place of [id]: any call
  // under its static prefix counts. A static one must be named whole, not
  // as the front of a longer path.
  if (dynamic >= 0) return allTests.includes(`/${route.slice(0, dynamic)}`);
  return new RegExp(`/${escapeRe(route)}(?![A-Za-z0-9_\\-/])`).test(allTests);
}

/** The paths a browser test visits, with ${...} read as an id. */
function visitedPaths(): Set<string> {
  const out = new Set<string>();
  for (const m of browserTests.matchAll(/["'`](\/[A-Za-z0-9_\-/[\]${}.]*)/g)) {
    out.add(m[1].replace(/\$\{[^}]*\}/g, "[id]").replace(/\/+$/, "") || "/");
  }
  return out;
}

function pageCovered(page: string, visited: Set<string>): boolean {
  return visited.has(page);
}

function scan(): { all: Inventory; uncovered: Inventory } {
  const visited = visitedPaths();
  const all: Inventory = { actions: serverActions(), routes: apiRoutes(), pages: [...new Set(pages())] };
  return {
    all,
    uncovered: {
      actions: all.actions.filter((a) => !actionCovered(a)),
      routes: all.routes.filter((r) => !routeCovered(r)),
      pages: all.pages.filter((p) => !pageCovered(p, visited)),
    },
  };
}

const KINDS = ["actions", "routes", "pages"] as const;

function onList(): Inventory {
  try {
    return JSON.parse(read(LIST)) as Inventory;
  } catch {
    return { actions: [], routes: [], pages: [] };
  }
}

describe("every page, route and server action has a test, or is on the list", () => {
  const { all, uncovered } = scan();

  if (process.env.UPDATE_COVERAGE === "1") {
    it("rewrites untested.json", () => {
      writeFileSync(LIST, JSON.stringify(uncovered, null, 2) + "\n");
      console.log(
        `[coverage] ${KINDS.map((k) => `${k}: ${all[k].length - uncovered[k].length}/${all[k].length} covered`).join(" · ")}`,
      );
    });
    return;
  }

  const listed = onList();

  it("reports where it stands", () => {
    console.log(
      `[coverage] ${KINDS.map((k) => `${k}: ${all[k].length - uncovered[k].length}/${all[k].length} covered`).join(" · ")}`,
    );
    expect(all.actions.length).toBeGreaterThan(100);
    expect(all.routes.length).toBeGreaterThan(50);
    expect(all.pages.length).toBeGreaterThan(80);
  });

  for (const kind of KINDS) {
    it(`no new ${kind} without a test`, () => {
      const onTheList = new Set(listed[kind]);
      const fresh = uncovered[kind].filter((x) => !onTheList.has(x));
      expect(
        fresh,
        `These ${kind} have no test and are not on test/coverage/untested.json. Write one (a unit, database or browser test that names it). If it truly cannot have one, add it to the list in this commit.`,
      ).toEqual([]);
    });

    it(`the list of untested ${kind} only shrinks`, () => {
      const stillUncovered = new Set(uncovered[kind]);
      const exists = new Set(all[kind]);
      const stale = listed[kind].filter((x) => !stillUncovered.has(x) || !exists.has(x));
      expect(
        stale,
        `These ${kind} are on test/coverage/untested.json but are now covered or gone. Take them off: UPDATE_COVERAGE=1 npx vitest run test/coverage`,
      ).toEqual([]);
    });
  }
});
