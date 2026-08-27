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

/** Inline spans: bold, italic, code, links. Input is already HTML-escaped. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="hx-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" class="hx-link">$1</a>',
    );
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

export function SimpleMarkdown({ source }: { source: string }) {
  const blocks = parse(source);
  const html = (text: string) => ({ __html: inline(escapeHtml(text)) });

  return (
    <div className="hx-article">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h2":
            return (
              <h2
                key={i}
                className="mt-8 mb-3 text-lg font-semibold first:mt-0"
                dangerouslySetInnerHTML={html(b.text)}
              />
            );
          case "h3":
            return (
              <h3
                key={i}
                className="mt-6 mb-2 text-sm font-semibold"
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
