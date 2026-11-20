"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, X, Send, Loader2, Flag, BookOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OPEN_ASSISTANT_EVENT } from "@/components/top-bar-actions";
import { ASK_ASSISTANT_EVENT } from "@/components/help/ask-assistant-button";
import { findSitePage, routePatternToRegExp } from "@/content/help/site-map";
import type { HelpGuideRef } from "@/content/help";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME: Message = {
  role: "assistant",
  content:
    "Hi! I'm your Sollos assistant. I've read the whole manual, so ask me how something works or where to find it. If something's actually broken, use Report a problem below — that reaches the team and you'll get a reply.",
};

/** A refusal the server explained (rate limit, too long, unavailable). */
class AssistantRefusal extends Error {}

/** The guide that covers this page, if one claims it (static claims first,
 *  the same rule as helpForUrl on the server). */
function guideForPath(guides: HelpGuideRef[], path: string): HelpGuideRef | undefined {
  let dynamicHit: HelpGuideRef | undefined;
  for (const g of guides) {
    for (const p of g.paths) {
      if (!routePatternToRegExp(p).test(path)) continue;
      if (!p.includes("[")) return g;
      dynamicHit ??= g;
    }
  }
  return dynamicHit;
}

export function AIWidget({ guides = [] }: { guides?: HelpGuideRef[] }) {
  const pathname = usePathname();
  const pageGuide = guideForPath(guides, pathname);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // The phone top bar's sparkle (TopBarActions) opens the panel; tapping it
  // again closes it, like the floating button did.
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    window.addEventListener(OPEN_ASSISTANT_EVENT, toggle);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, toggle);
  }, []);

  // Help's "Ask the assistant" buttons open the panel with the question
  // typed in (not sent — the person may want to add to it).
  useEffect(() => {
    const ask = (e: Event) => {
      const q = (e as CustomEvent<{ question?: string }>).detail?.question ?? "";
      setOpen(true);
      if (q) setInput(q);
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 60);
    };
    window.addEventListener(ASK_ASSISTANT_EVENT, ask);
    return () => window.removeEventListener(ASK_ASSISTANT_EVENT, ask);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = { role: "user", content: text };
    const history = [...messages.filter((m) => m !== WELCOME), userMessage];

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // Append empty assistant message to stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          currentPage: pathname,
        }),
      });

      if (!res.ok || !res.body) {
        // The server explains itself in plain words (slow down, start a
        // fresh conversation, not available right now); pass that on rather
        // than a generic apology that leaves the person guessing.
        const reason = await res
          .json()
          .then((j: { error?: unknown }) => (typeof j.error === "string" ? j.error : null))
          .catch(() => null);
        if (reason) throw new AssistantRefusal(reason);
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const snap = accumulated;
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: snap };
          return next;
        });
      }
    } catch (err) {
      // Only the server's own words; a dropped connection's raw message
      // ("network error") means nothing to anyone.
      const reason = err instanceof AssistantRefusal ? err.message : null;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: reason ?? "Sorry, something went wrong. Please try again.",
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Chat is a full-height surface with its own composer pinned to the bottom
  // edge, so a floating button there covers the message list and the input.
  // The assistant is one tap away from every other page.
  if (pathname.startsWith("/app/chat")) return null;

  return (
    // bottom-24 below lg: the admin tab bar owns the bottom edge on
    // phones, and bottom-5 parked this button squarely on its More tab.
    <div className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-3 lg:bottom-5 lg:right-5">
      {/* Chat panel. Capped to the screen: a fixed 360x520 ran off the left
          edge of a 375px phone and under the top bar on short ones. */}
      {open && (
        <div className="flex h-[min(520px,calc(100dvh-11rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between bg-primary px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
              <div>
                <p className="text-sm font-semibold text-primary-foreground">
                  Sollos Assistant
                </p>
                <p className="text-[11px] text-primary-foreground/70">
                  Powered by Velluma
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-md p-1 text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                    msg.role === "assistant" && msg.content === "" && "min-w-8",
                  )}
                >
                  {msg.content === "" && loading ? (
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                      <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                    </span>
                  ) : (
                    <MessageContent
                      content={msg.content}
                      guides={guides}
                      done={!(loading && i === messages.length - 1)}
                      onNavigate={() => setOpen(false)}
                    />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            {pageGuide && (
              <Link
                href={`/app/help/${pageGuide.slug}`}
                onClick={() => setOpen(false)}
                className="mb-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <BookOpen className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  Guide for this page: <span className="font-medium">{pageGuide.title}</span>
                </span>
              </Link>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything or report an issue…"
                rows={1}
                disabled={loading}
                className="max-h-24 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
                style={{ fieldSizing: "content" } as React.CSSProperties}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="mb-0.5 flex-shrink-0 rounded-lg bg-primary p-1.5 text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {/* This line used to read "Feedback is shared with the Sollos
                team". It was not: chats went to a table nothing and nobody
                read (no longer saved since 2026-11-11). The honest version is a button that
                actually reaches someone — and it carries the page the user is
                on, so the report arrives knowing where they were. */}
            <Link
              href={`/app/feedback/new?page=${encodeURIComponent(pathname)}`}
              onClick={() => setOpen(false)}
              className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Flag className="h-3 w-3" />
              Report a problem to the Sollos team
            </Link>
          </div>
        </div>
      )}

      {/* Floating button — desktop only. Phones open the assistant from the
          top bar (TopBarActions); floating here it covered page content. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "hidden h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 lg:flex",
          open
            ? "bg-muted text-muted-foreground"
            : "bg-primary text-primary-foreground",
        )}
        aria-label="Open Sollos Assistant"
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <Sparkles className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}

/**
 * Is this an address a person can actually open? The assistant is told to
 * link only pages from the site map, but a model can still slip — and a
 * confident link to a page that doesn't exist is exactly the failure that
 * started this. So every link is checked here before it becomes clickable.
 * Only fixed addresses count: the assistant never knows a record's id, so
 * "/app/bookings/123" is invented by definition.
 */
function checkAppUrl(url: string, guides: HelpGuideRef[]): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, "");
  const help = path.match(/^\/app\/help\/([a-z0-9-]+)$/);
  if (help) return guides.length === 0 || guides.some((g) => g.slug === help[1]);
  // A match that only fits a [param] route is a made-up record address.
  const page = findSitePage(path || "/");
  return Boolean(page && !page.path.includes("["));
}

// Links, bold, and bare in-app paths, in one pass.
const TOKEN =
  /(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|((?<![\w/.])\/(?:app|field|client)(?:\/[A-Za-z0-9_\-[\]]+)*(?:#[a-z0-9-]+)?)/g;

// Render assistant messages: **bold**, [links](/app/...), bare /app/... paths.
function MessageContent({
  content,
  guides,
  done,
  onNavigate,
}: {
  content: string;
  guides: HelpGuideRef[];
  done: boolean;
  onNavigate: () => void;
}) {
  const nodes: React.ReactNode[] = [];
  let invented = false;
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(content))) {
    if (m.index > last) nodes.push(content.slice(last, m.index));
    const key = m.index;
    if (m[2]) {
      nodes.push(<strong key={key}>{m[2].slice(2, -2)}</strong>);
    } else {
      let text: string;
      let href: string;
      if (m[1]) {
        const lm = m[1].match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
        text = lm[1];
        href = lm[2];
      } else {
        text = m[3];
        href = m[3];
      }
      const internal = href.startsWith("/");
      const ok = internal && checkAppUrl(href, guides);
      if (ok) {
        nodes.push(
          <Link
            key={key}
            href={href}
            onClick={onNavigate}
            className="font-medium text-primary underline underline-offset-2"
          >
            {text}
          </Link>,
        );
      } else {
        // External links and addresses that don't exist stay plain text.
        // Mid-stream a path is often half-written, so only judge it once
        // the answer is complete.
        if (internal && done) invented = true;
        nodes.push(
          <span
            key={key}
            className={cn(internal && done && "text-muted-foreground line-through decoration-amber-500/70")}
            title={internal && done ? "This page doesn't exist in Sollos" : undefined}
          >
            {text}
          </span>,
        );
      }
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) nodes.push(content.slice(last));

  return (
    <>
      <span className="whitespace-pre-wrap">{nodes}</span>
      {invented && (
        <span className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>
            A page named here doesn&apos;t exist in Sollos, so this answer may be
            wrong about where to go.{" "}
            <Link href="/app/help" onClick={onNavigate} className="underline underline-offset-2">
              Search Help
            </Link>{" "}
            instead.
          </span>
        </span>
      )}
    </>
  );
}
