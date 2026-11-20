import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP_ARTICLES, HELP_SECTIONS, helpForUrl, searchHelp } from "./index";
import { SITE_MAP, findSitePage, staticUrlFor } from "./site-map";
import { chunkArticle } from "./search";
import { headingAnchor } from "@/lib/simple-markdown";

/**
 * The manual is only worth reading if what it points at exists. The assistant
 * answers from these guides and from SITE_MAP, so a wrong path here becomes a
 * wrong answer to a customer — which is how this file came about: the
 * assistant gave a user a path that didn't exist.
 */

const APP_DIR = join(__dirname, "..", "..", "app");

/** Every page route under the given top-level folders, as a pattern. */
function pageRoutes(tops: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx") {
        const rel = relative(APP_DIR, dir).split(sep).join("/");
        out.push(`/${rel}`);
      }
    }
  };
  for (const t of tops) walk(join(APP_DIR, t));
  return out.sort();
}

const COVERED_TOPS = ["app", "field", "client"];
const SITE_PATHS = new Set(SITE_MAP.map((p) => p.path));

describe("site map", () => {
  it("lists every office, field and portal page that exists", () => {
    const missing = pageRoutes(COVERED_TOPS).filter((r) => !SITE_PATHS.has(r));
    expect(missing, "pages on disk with no SITE_MAP entry — add them to site-map.ts").toEqual([]);
  });

  it("lists no page that doesn't exist", () => {
    const onDisk = new Set(
      pageRoutes(COVERED_TOPS).concat(
        // Public pages people are sent to, listed for completeness.
        pageRoutes(["e", "c", "i", "pay", "review", "claim", "join", "u", "texting", "help"]),
      ),
    );
    const ghosts = SITE_MAP.map((p) => p.path).filter((p) => !onDisk.has(p));
    expect(ghosts, "SITE_MAP entries with no page.tsx").toEqual([]);
  });

  it("has no duplicate entries", () => {
    expect(SITE_MAP.length).toBe(SITE_PATHS.size);
  });

  it("matches concrete URLs, preferring fixed pages over record pages", () => {
    expect(findSitePage("/app/bookings/new")?.name).toBe("New booking");
    expect(findSitePage("/app/bookings/3f2a")?.path).toBe("/app/bookings/[id]");
    expect(findSitePage("/client/jobs")?.path).toBe("/client/(portal)/jobs");
    expect(findSitePage("/app/settings/timezone?x=1")?.name).toBe("Timezone");
    expect(findSitePage("/app/settings/time-zone")).toBeUndefined();
    expect(staticUrlFor("/client/(portal)/invoices")).toBe("/client/invoices");
    expect(staticUrlFor("/app/bookings/[id]")).toBeNull();
  });
});

describe("help articles", () => {
  const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));

  it("have unique slugs and known sections", () => {
    expect(slugs.size).toBe(HELP_ARTICLES.length);
    for (const a of HELP_ARTICLES) {
      expect(HELP_SECTIONS, a.slug).toContain(a.section);
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(a.title.trim(), a.slug).not.toBe("");
      expect(a.blurb.trim(), a.slug).not.toBe("");
      expect(a.body.trim().length, a.slug).toBeGreaterThan(200);
    }
  });

  it("claim only real pages, and no page is claimed twice", () => {
    const owner = new Map<string, string>();
    for (const a of HELP_ARTICLES) {
      for (const p of a.paths) {
        expect(SITE_PATHS.has(p), `${a.slug} claims ${p}, which isn't a page`).toBe(true);
        const prev = owner.get(p);
        expect(prev, `${p} is claimed by both ${prev} and ${a.slug}`).toBeUndefined();
        owner.set(p, a.slug);
      }
    }
  });

  it("link only to app pages that exist", () => {
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const m of a.body.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const url = m[1].split("#")[0];
        const page = findSitePage(url);
        if (!page || page.path.includes("[")) bad.push(`${a.slug} → ${m[1]}`);
      }
    }
    expect(bad, "links to pages that don't exist (or to a record page with a made-up id)").toEqual([]);
  });

  it("mention only app paths that exist, even in plain text", () => {
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const m of a.body.matchAll(/`(\/(?:app|field|client)[^`\s]*)`/g)) {
        if (!findSitePage(m[1].split("#")[0])) bad.push(`${a.slug} → ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("link to other guides, and sections of them, that exist", () => {
    const anchors = new Map(
      HELP_ARTICLES.map((a) => [
        a.slug,
        new Set([...a.body.matchAll(/^#{2,3} (.+)$/gm)].map((m) => headingAnchor(m[1]))),
      ]),
    );
    const bad: string[] = [];
    for (const a of HELP_ARTICLES) {
      for (const m of a.body.matchAll(/\]\(help:([^)#\s]+)(?:#([^)\s]+))?\)/g)) {
        const [, slug, frag] = m;
        if (!anchors.has(slug)) bad.push(`${a.slug} → help:${slug} (no such guide)`);
        else if (frag && !anchors.get(slug)!.has(frag))
          bad.push(`${a.slug} → help:${slug}#${frag} (no such section)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("use only the markdown the renderer understands", () => {
    for (const a of HELP_ARTICLES) {
      expect(a.body, `${a.slug}: tables don't render`).not.toMatch(/^\s*\|.*\|\s*$/m);
      expect(a.body, `${a.slug}: raw HTML doesn't render`).not.toMatch(/<\/?[a-z][a-z0-9]*[\s>]/i);
      expect(a.body, `${a.slug}: #### headings don't render`).not.toMatch(/^####/m);
    }
  });

  it("end with questions people actually ask", () => {
    for (const a of HELP_ARTICLES) {
      const qs = chunkArticle(a).filter((c) => c.kind === "question");
      expect(qs.length, `${a.slug} has no "## Common questions" entries`).toBeGreaterThan(0);
    }
  });
});

describe("help search", () => {
  it("finds guides by their own words and by synonyms", () => {
    expect(searchHelp("invoice")[0]?.slug).toBe("invoicing");
    // "bill" is a keyword of invoicing, not necessarily a word in it.
    expect(searchHelp("bill a client").map((r) => r.slug)).toContain("invoicing");
    expect(searchHelp("skip a visit").length).toBeGreaterThan(0);
  });

  it("stems word forms onto each other", async () => {
    const { stem } = await import("./search");
    expect(stem("skipping")).toBe(stem("skip"));
    expect(stem("invoices")).toBe(stem("invoicing"));
    expect(stem("scheduled")).toBe(stem("schedule"));
  });

  it("returns nothing for nothing", () => {
    expect(searchHelp("")).toEqual([]);
    expect(searchHelp("the and of")).toEqual([]);
  });

  it("finds the guide for the page you're on", () => {
    expect(helpForUrl("/app/bookings/new")?.slug).toBe("bookings");
    expect(helpForUrl("/app/invoices/abc123")?.slug).toBe("invoicing");
  });
});
