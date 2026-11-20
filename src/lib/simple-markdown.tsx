import React from "react";

/**
 * Tiny markdown renderer for the in-app Help section.
 *
 * Deliberately NOT a dependency: help articles are first-party strings that
 * live in the repo (src/content/help) and deploy with the code they describe,
 * so the supported grammar can stay small — headings, paragraphs, lists,
 * bold/italic/inline-code, links, callouts (>), and rules. If an article
 * needs more than this, the article is probably trying too hard.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A heading as a URL fragment: "Crew arriving at different times" →
 *  "crew-arriving-at-different-times". Guides link to each other with
 *  help:slug#fragment, and search results land on the matching section. */
export function headingAnchor(text: string): string {
  return text
    .replace(/[*`_]/g, "")
    .toLowerCase()
    .replace(/&amp;|&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type MarkdownLinkMode = {
  /** Where help:slug links point: "/app/help" signed in, "/help" public. */
  helpBase: string;
  /** Public pages can't open /app, /field or /client pages for a visitor, so
   *  there those links render as plain bold text instead of dead ends. */
  appLinks: boolean;
};

const DEFAULT_MODE: MarkdownLinkMode = { helpBase: "/app/help", appLinks: true };

/** Inline spans: bold, italic, code, links. Input is already HTML-escaped. */
function inline(s: string, mode: MarkdownLinkMode = DEFAULT_MODE): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="hx-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) => {
      if (href.startsWith("help:")) {
        const [slug, frag] = href.slice(5).split("#");
        const url = `${mode.helpBase}/${slug}${frag ? `#${frag}` : ""}`;
        return `<a href="${url}" class="hx-link">${text}</a>`;
      }
      if (!mode.appLinks && /^\/(app|field|client)(\/|$)/.test(href)) {
        return `<strong>${text}</strong>`;
      }
      return `<a href="${href}" class="hx-link">${text}</a>`;
    });
}

type Block =
  | { kind: "h2" | "h3" | "p" | "quote"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: "quote", text: quote.join(" ") });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") {
      flushAll();
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushAll();
      blocks.push({ kind: "h3", text: trimmed.slice(4) });
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushAll();
      blocks.push({ kind: "h2", text: trimmed.slice(3) });
      continue;
    }
    if (trimmed === "---") {
      flushAll();
      blocks.push({ kind: "hr" });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      flushPara();
      flushList();
      quote.push(trimmed.slice(2));
      continue;
    }
    const ulMatch = trimmed.match(/^- (.*)$/);
    if (ulMatch) {
      flushPara();
      flushQuote();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ulMatch[1]);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\. (.*)$/);
    if (olMatch) {
      flushPara();
      flushQuote();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(olMatch[1]);
      continue;
    }
    flushList();
    flushQuote();
    para.push(trimmed);
  }
  flushAll();
  return blocks;
}

/** The article's ## headings, for an "On this page" list. */
export function markdownOutline(source: string): { text: string; anchor: string }[] {
  return parse(source)
    .filter((b): b is { kind: "h2"; text: string } => b.kind === "h2")
    .map((b) => ({
      text: b.text.replace(/[*`]/g, ""),
      anchor: headingAnchor(b.text),
    }));
}

export function SimpleMarkdown({
  source,
  mode = DEFAULT_MODE,
}: {
  source: string;
  mode?: MarkdownLinkMode;
}) {
  const blocks = parse(source);
  const html = (text: string) => ({ __html: inline(escapeHtml(text), mode) });

  return (
    <div className="hx-article">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2":
            return (
              <h2
                key={i}
                id={headingAnchor(b.text)}
                className="mt-8 mb-3 scroll-mt-20 text-lg font-semibold first:mt-0"
                dangerouslySetInnerHTML={html(b.text)}
              />
            );
          case "h3":
            return (
              <h3
                key={i}
                id={headingAnchor(b.text)}
                className="mt-6 mb-2 scroll-mt-20 text-sm font-semibold"
                dangerouslySetInnerHTML={html(b.text)}
              />
            );
          case "p":
            return (
              <p
                key={i}
                className="mb-3 text-sm leading-6 text-foreground/90"
                dangerouslySetInnerHTML={html(b.text)}
              />
            );
          case "quote":
            return (
              <div
                key={i}
                className="mb-4 rounded-md border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm leading-6 dark:border-amber-800 dark:bg-amber-950/30"
                dangerouslySetInnerHTML={html(b.text)}
              />
            );
          case "ul":
            return (
              <ul key={i} className="mb-4 list-disc space-y-1.5 pl-5 text-sm leading-6">
                {b.items.map((it, j) => (
                  <li key={j} dangerouslySetInnerHTML={html(it)} />
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="mb-4 list-decimal space-y-1.5 pl-5 text-sm leading-6">
                {b.items.map((it, j) => (
                  <li key={j} dangerouslySetInnerHTML={html(it)} />
                ))}
              </ol>
            );
          case "hr":
            return <hr key={i} className="my-6 border-border" />;
        }
      })}
      {/* Inline code chips — styled here so articles stay plain markdown. */}
      <style>{`
        .hx-article .hx-code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.8em;
          background: hsl(var(--muted) / 0.6);
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          padding: 0.1em 0.35em;
          white-space: nowrap;
        }
        .hx-article .hx-link { text-decoration: underline; text-underline-offset: 2px; }
      `}</style>
    </div>
  );
}
