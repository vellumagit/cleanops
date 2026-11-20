import { headingAnchor } from "@/lib/simple-markdown";
import type { HelpArticle } from "./types";

/**
 * Search over the manual. No service, no index to rebuild: the guides are a
 * few hundred KB of text that ships with the code, so scoring every section
 * per query takes a millisecond or two on the server.
 *
 * Results land on a SECTION, not an article — "how do I skip one visit"
 * should open Bookings at "Deleting and skipping", not at the top of a long
 * page. Each "Common questions" entry is its own result too, since those are
 * written in the words people actually type.
 */

export type HelpChunk = {
  slug: string;
  articleTitle: string;
  section: string;
  /** The ## heading, or the question for a Q&A entry; null for the intro. */
  heading: string | null;
  /** URL fragment on the article page. */
  anchor: string | null;
  kind: "intro" | "section" | "question";
  text: string;
  keywords: string[];
};

export type HelpSearchResult = HelpChunk & { score: number; snippet: string };

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from get got how i if in into is it its me my of on or so that the their them then there this to up was we what when where which who why will with you your sollos".split(
    " ",
  ),
);

/** Plain text from the small markdown grammar. */
function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`>]/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*(-|\d+\.)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Crude English stem: enough that "invoices", "invoicing" and "invoiced"
 *  meet at "invoic". Not linguistics — just fewer misses. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length <= 3) return w;
  for (const suf of ["ations", "ation", "ings", "ing", "ies", "ied", "es", "ed", "ly", "s", "e"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      // "skipping" → "skipp" → "skip", so it meets "skip".
      if (/(ing|ings|ed)$/.test(suf) && /([bdgmnprt])\1$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  return w;
}

export function queryTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .map((w) => w.replace(/'/g, ""))
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
        .map(stem)
        .filter(Boolean),
    ),
  ];
}

function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((w) => stem(w.replace(/'/g, "")))
    .filter(Boolean);
}

export function chunkArticle(a: HelpArticle): HelpChunk[] {
  const base = {
    slug: a.slug,
    articleTitle: a.title,
    section: a.section,
    keywords: a.keywords,
  };
  const chunks: HelpChunk[] = [];
  const parts = a.body.split(/^## /m);
  const intro = parts.shift() ?? "";
  if (plain(intro)) {
    chunks.push({ ...base, heading: null, anchor: null, kind: "intro", text: plain(intro) });
  }
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const rest = nl < 0 ? "" : part.slice(nl + 1);
    const anchor = headingAnchor(heading);

    if (/^common questions$/i.test(heading)) {
      // "**Question?** Answer…" paragraphs become one result each.
      for (const para of rest.split(/\n\s*\n/)) {
        const m = para.trim().match(/^\*\*(.+?\?)\*\*\s*([\s\S]*)$/);
        if (m) {
          chunks.push({
            ...base,
            heading: m[1].trim(),
            anchor,
            kind: "question",
            text: plain(m[2]),
          });
        }
      }
      continue;
    }
    chunks.push({
      ...base,
      heading: heading.replace(/[*`]/g, ""),
      anchor,
      kind: "section",
      text: plain(rest),
    });
  }
  return chunks;
}

type Indexed = {
  chunk: HelpChunk;
  title: Set<string>;
  heading: Set<string>;
  keywords: Set<string>;
  body: Map<string, number>;
  lower: string;
};

function indexChunks(chunks: HelpChunk[]): Indexed[] {
  return chunks.map((chunk) => {
    const body = new Map<string, number>();
    for (const s of stems(chunk.text)) body.set(s, (body.get(s) ?? 0) + 1);
    return {
      chunk,
      title: new Set(stems(chunk.articleTitle)),
      heading: new Set(stems(chunk.heading ?? "")),
      keywords: new Set(chunk.keywords.flatMap(stems)),
      body,
      lower: `${chunk.heading ?? ""} ${chunk.text}`.toLowerCase(),
    };
  });
}

function makeSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.search(new RegExp(`\\b${t.replace(/[^a-z0-9]/g, "")}`));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return text.length > 180 ? `${text.slice(0, 180).trimEnd()}…` : text;
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, start + 200);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function createHelpSearch(articles: HelpArticle[]) {
  const index = indexChunks(articles.flatMap(chunkArticle));

  return function search(q: string, limit = 12): HelpSearchResult[] {
    const terms = queryTerms(q);
    if (terms.length === 0) return [];
    const phrase = q.trim().toLowerCase();

    const scored: HelpSearchResult[] = [];
    for (const it of index) {
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        let s = 0;
        if (it.heading.has(t)) s += 5;
        if (it.title.has(t)) s += 4;
        if (it.keywords.has(t)) s += 3;
        const n = it.body.get(t) ?? 0;
        if (n > 0) s += 1 + Math.log2(n);
        // Prefix match for half-typed words ("invo").
        if (s === 0 && t.length >= 3) {
          for (const w of it.heading) if (w.startsWith(t)) { s += 2; break; }
          if (s === 0) for (const w of it.body.keys()) if (w.startsWith(t)) { s += 0.5; break; }
        }
        if (s > 0) matched++;
        score += s;
      }
      if (matched === 0) continue;
      // Sections that answer the WHOLE question beat ones that mention one word
      // of it a lot.
      const coverage = matched / terms.length;
      score *= coverage * coverage;
      if (phrase.length > 4 && it.lower.includes(phrase)) score += 6;
      if (it.chunk.kind === "question") score *= 1.15;
      scored.push({ ...it.chunk, score, snippet: makeSnippet(it.chunk.text, terms) });
    }

    scored.sort((a, b) => b.score - a.score);
    // No more than three results from one guide, so one long article can't
    // bury the rest.
    const perArticle = new Map<string, number>();
    const out: HelpSearchResult[] = [];
    for (const r of scored) {
      const n = perArticle.get(r.slug) ?? 0;
      if (n >= 3) continue;
      perArticle.set(r.slug, n + 1);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  };
}
