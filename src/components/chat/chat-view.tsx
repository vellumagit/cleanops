"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Hash, MessageCircle, Plus, Send, Check, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  sendChatMessageAction,
  createDmThreadAction,
  markThreadReadAction,
} from "@/lib/chat-actions";
import type {
  ChatMessage,
  ChatThreadSummary,
  TeammateOption,
} from "@/lib/chat-data";

type Props = {
  threads: ChatThreadSummary[];
  teammates: TeammateOption[];
  activeThreadId: string | null;
  initialMessages: ChatMessage[];
  currentMembershipId: string;
  basePath: "/app/chat" | "/field/chat";
  variant: "desktop" | "mobile";
};

// Local message shape: the persisted ChatMessage plus optimistic send state.
type UiMessage = ChatMessage & {
  clientKey?: string;
  status?: "sending" | "failed";
};

const GROUP_GAP_MS = 5 * 60 * 1000; // start a new visual group after 5 min

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function initialsOf(name: string | null | undefined) {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "")
  ).toUpperCase();
}

function ThreadIcon({ kind }: { kind: ChatThreadSummary["kind"] }) {
  return kind === "group" ? (
    <Hash className="h-4 w-4 shrink-0" />
  ) : (
    <MessageCircle className="h-4 w-4 shrink-0" />
  );
}

function Avatar({ name }: { name: string | null | undefined }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
      {initialsOf(name)}
    </div>
  );
}

export function ChatView({
  threads,
  teammates,
  activeThreadId,
  initialMessages,
  currentMembershipId,
  basePath,
  variant,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [, startSending] = useTransition();
  const [creatingDm, startCreatingDm] = useTransition();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const keyCounter = useRef(0);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const isMobile = variant === "mobile";

  // For DM threads we can resolve any incoming sender's name from the thread
  // (it's the other participant), so realtime rows that arrive without a name
  // still render correctly without a server round-trip.
  const dmOtherName =
    activeThread?.kind === "dm" ? activeThread.display_name : null;
  const resolveName = (m: UiMessage) =>
    m.sender_name ?? (dmOtherName || "Teammate");

  // Reset to server state whenever the active thread changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(initialMessages);
  }, [initialMessages, activeThreadId]);

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Mark the open thread read (advances the unread watermark).
  useEffect(() => {
    if (activeThreadId) markThreadReadAction(activeThreadId).catch(() => {});
  }, [activeThreadId]);

  // Realtime: append inbound messages, replacing the optimistic copy of our
  // own sends so they never double up.
  useEffect(() => {
    if (!activeThreadId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`chat:${activeThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `thread_id=eq.${activeThreadId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            thread_id: string;
            sender_id: string | null;
            body: string;
            created_at: string;
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            // Replace our own optimistic message (matched by body + sender)
            // rather than appending a duplicate.
            const optimisticIdx = prev.findIndex(
              (m) =>
                m.status === "sending" &&
                m.sender_id === row.sender_id &&
                m.body === row.body,
            );
            const next: UiMessage = {
              id: row.id,
              thread_id: row.thread_id,
              sender_id: row.sender_id,
              sender_name: null,
              body: row.body,
              created_at: row.created_at,
            };
            if (optimisticIdx >= 0) {
              const copy = prev.slice();
              copy[optimisticIdx] = next;
              return copy;
            }
            return [...prev, next];
          });
          // We're looking at this thread, so anything that lands is read.
          if (row.sender_id !== currentMembershipId) {
            markThreadReadAction(activeThreadId).catch(() => {});
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeThreadId, currentMembershipId]);

  function selectThread(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("thread", id);
    router.push(`${pathname}?${next.toString()}`);
  }

  function deliver(threadId: string, body: string, clientKey: string) {
    startSending(async () => {
      const res = await sendChatMessageAction(threadId, body);
      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientKey === clientKey ? { ...m, status: "failed" } : m,
          ),
        );
        toast.error(res.error);
        return;
      }
      // Promote the optimistic message to a real one (unless realtime already
      // swapped it in).
      setMessages((prev) =>
        prev.map((m) =>
          m.clientKey === clientKey
            ? { ...m, id: res.id, status: undefined, clientKey: undefined }
            : m,
        ),
      );
    });
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeThreadId) return;
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    const clientKey = `local-${(keyCounter.current += 1)}`;
    const optimistic: UiMessage = {
      id: clientKey,
      clientKey,
      thread_id: activeThreadId,
      sender_id: currentMembershipId,
      sender_name: null,
      body,
      created_at: new Date().toISOString(),
      status: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    deliver(activeThreadId, body, clientKey);
  }

  function retry(m: UiMessage) {
    if (!m.clientKey) return;
    setMessages((prev) =>
      prev.map((x) =>
        x.clientKey === m.clientKey ? { ...x, status: "sending" } : x,
      ),
    );
    deliver(m.thread_id, m.body, m.clientKey);
  }

  function handleCreateDm(e: React.FormEvent) {
    e.preventDefault();
    if (!otherId) return;
    startCreatingDm(async () => {
      const res = await createDmThreadAction(otherId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPickerOpen(false);
      setOtherId("");
      router.push(`${basePath}?thread=${res.thread_id}`);
      router.refresh();
    });
  }

  // Only members with a login account can actually open the app and read a
  // DM. Manually-added "shadow" employees (reachable === false) are shown as
  // a note instead of selectable options so messages never go to a void.
  const reachableTeammates = teammates.filter((t) => t.reachable);
  const unreachableTeammates = teammates.filter((t) => !t.reachable);

  // Pre-compute day dividers + message grouping so the render stays declarative.
  const rows = useMemo(() => {
    const out: Array<
      | { kind: "divider"; key: string; label: string }
      | {
          kind: "msg";
          key: string;
          m: UiMessage;
          mine: boolean;
          firstOfGroup: boolean;
          lastOfGroup: boolean;
        }
    > = [];
    let lastDay: string | null = null;
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const t = new Date(m.created_at).getTime();
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) {
        out.push({ kind: "divider", key: `d-${day}`, label: dayLabel(m.created_at) });
        lastDay = day;
      }
      const firstOfGroup =
        !prev ||
        prev.sender_id !== m.sender_id ||
        new Date(prev.created_at).toDateString() !== day ||
        t - new Date(prev.created_at).getTime() >= GROUP_GAP_MS;
      const lastOfGroup =
        !next ||
        next.sender_id !== m.sender_id ||
        new Date(next.created_at).toDateString() !== day ||
        new Date(next.created_at).getTime() - t >= GROUP_GAP_MS;
      out.push({
        kind: "msg",
        key: m.id,
        m,
        mine: m.sender_id === currentMembershipId,
        firstOfGroup,
        lastOfGroup,
      });
    });
    return out;
  }, [messages, currentMembershipId]);

  // On mobile we collapse to a single pane: thread list OR active thread.
  const showThreadList = !isMobile || !activeThread;
  const showThreadPane = !isMobile || !!activeThread;
  const isGroup = activeThread?.kind === "group";

  return (
    <div
      className={cn(
        "flex w-full",
        isMobile
          ? "h-[calc(100dvh-12rem)] flex-col"
          : "h-[calc(100dvh-12rem)] overflow-hidden rounded-lg border border-border bg-card",
      )}
    >
      {showThreadList && (
        <aside
          className={cn(
            isMobile
              ? "w-full"
              : "w-64 shrink-0 border-r border-border bg-background/60",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Threads
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Start a new DM"
            >
              <Plus className="h-3.5 w-3.5" />
              New DM
            </button>
          </div>

          {pickerOpen && (
            <form
              onSubmit={handleCreateDm}
              className="space-y-2 border-b border-border bg-card/60 px-3 py-3"
            >
              {reachableTeammates.length === 0 ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                  {teammates.length === 0
                    ? "No teammates yet. When the owner invites or adds another member, they’ll show up here to DM."
                    : "No teammates have joined the app yet. Once they accept their invite or claim their account, you can message them here."}
                </p>
              ) : (
                <FormSelect
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                >
                  <option value="">Pick a teammate…</option>
                  {reachableTeammates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </FormSelect>
              )}
              {unreachableTeammates.length > 0 && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {unreachableTeammates.length} teammate
                  {unreachableTeammates.length === 1 ? "" : "s"} (
                  {unreachableTeammates
                    .slice(0, 3)
                    .map((t) => t.label)
                    .join(", ")}
                  {unreachableTeammates.length > 3
                    ? `, +${unreachableTeammates.length - 3} more`
                    : ""}
                  ) haven&rsquo;t joined the app yet, so they can&rsquo;t receive
                  messages. Invite them from Employees, or have them accept their
                  invite.
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPickerOpen(false);
                    setOtherId("");
                  }}
                >
                  {reachableTeammates.length === 0 ? "Close" : "Cancel"}
                </Button>
                {reachableTeammates.length > 0 && (
                  <Button
                    type="submit"
                    size="sm"
                    disabled={creatingDm || !otherId}
                  >
                    {creatingDm ? "Opening…" : "Open DM"}
                  </Button>
                )}
              </div>
            </form>
          )}

          <ul className="space-y-0.5 px-2 py-2">
            {threads.length === 0 ? (
              <li className="px-2 py-3 text-xs text-muted-foreground">
                No threads yet. Start a DM with a teammate.
              </li>
            ) : (
              threads.map((t) => {
                const active = t.id === activeThreadId;
                // The thread you're viewing is, by definition, read.
                const unread = active ? 0 : t.unread;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                        active
                          ? "bg-muted font-medium text-foreground"
                          : unread > 0
                            ? "font-semibold text-foreground hover:bg-muted/50"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      {t.kind === "dm" ? (
                        <Avatar name={t.display_name} />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Hash className="h-3.5 w-3.5" />
                        </div>
                      )}
                      <span className="flex-1 truncate">{t.display_name}</span>
                      {unread > 0 && (
                        <span className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>
      )}

      {showThreadPane && (
        <section className="flex min-w-0 flex-1 flex-col bg-background/30">
          {activeThread ? (
            <>
              <header className="flex items-center gap-2.5 border-b border-border bg-card/80 px-3 py-2.5 backdrop-blur">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => router.push(basePath)}
                    className="-ml-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Back to threads"
                  >
                    ←
                  </button>
                )}
                {activeThread.kind === "dm" ? (
                  <Avatar name={activeThread.display_name} />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Hash className="h-3.5 w-3.5" />
                  </div>
                )}
                <span className="truncate text-sm font-semibold">
                  {activeThread.display_name}
                </span>
              </header>

              <div
                ref={scrollerRef}
                className="flex-1 space-y-1 overflow-y-auto px-3 py-4"
              >
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                    <ThreadIcon kind={activeThread.kind} />
                    <p className="mt-1 text-sm font-medium">
                      {activeThread.display_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      This is the start of your conversation. Say hi 👋
                    </p>
                  </div>
                ) : (
                  rows.map((r) => {
                    if (r.kind === "divider") {
                      return (
                        <div
                          key={r.key}
                          className="flex justify-center py-2"
                        >
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {r.label}
                          </span>
                        </div>
                      );
                    }
                    const { m, mine, firstOfGroup, lastOfGroup } = r;
                    const showAvatar = !mine && isGroup;
                    return (
                      <div
                        key={r.key}
                        className={cn(
                          "flex items-end gap-2",
                          mine ? "justify-end" : "justify-start",
                          firstOfGroup ? "mt-2" : "mt-0.5",
                        )}
                      >
                        {showAvatar &&
                          (lastOfGroup ? (
                            <Avatar name={resolveName(m)} />
                          ) : (
                            <div className="w-7 shrink-0" />
                          ))}
                        <div
                          className={cn(
                            "flex max-w-[78%] flex-col",
                            mine ? "items-end" : "items-start",
                          )}
                        >
                          {firstOfGroup && !mine && isGroup && (
                            <span className="mb-0.5 px-1 text-[11px] font-medium text-muted-foreground">
                              {resolveName(m)}
                            </span>
                          )}
                          <div
                            className={cn(
                              "px-3 py-2 text-sm leading-relaxed shadow-xs",
                              mine
                                ? "bg-primary text-primary-foreground"
                                : "bg-card text-foreground ring-1 ring-border",
                              // Asymmetric radius for a chat-bubble tail.
                              "rounded-2xl",
                              mine
                                ? lastOfGroup
                                  ? "rounded-br-sm"
                                  : ""
                                : lastOfGroup
                                  ? "rounded-bl-sm"
                                  : "",
                              m.status === "failed" && "opacity-70",
                            )}
                          >
                            <span className="whitespace-pre-wrap break-words">
                              {m.body}
                            </span>
                          </div>
                          {lastOfGroup && (
                            <div
                              className={cn(
                                "mt-0.5 flex items-center gap-1 px-1 text-[10px] tabular-nums",
                                mine
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {m.status === "sending" ? (
                                <span>Sending…</span>
                              ) : m.status === "failed" ? (
                                <button
                                  type="button"
                                  onClick={() => retry(m)}
                                  className="inline-flex items-center gap-1 font-medium text-red-600 hover:underline dark:text-red-400"
                                >
                                  <RotateCw className="h-3 w-3" />
                                  Failed — tap to retry
                                </button>
                              ) : (
                                <>
                                  <span>{formatTime(m.created_at)}</span>
                                  {mine && <Check className="h-3 w-3" />}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 border-t border-border bg-card/80 px-3 py-3 backdrop-blur"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  onFocus={(e) => {
                    setTimeout(() => {
                      e.target.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                      });
                    }, 300);
                  }}
                  placeholder="Message…"
                  rows={1}
                  className="flex max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={draft.trim().length === 0}
                  aria-label="Send"
                  className="h-10 w-10 shrink-0 rounded-full"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-20 text-center text-sm text-muted-foreground">
              Pick a thread on the left to start chatting.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
