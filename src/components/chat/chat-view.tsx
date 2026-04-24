"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Hash, MessageCircle, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  sendChatMessageAction,
  createDmThreadAction,
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

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ThreadIcon({ kind }: { kind: ChatThreadSummary["kind"] }) {
  return kind === "group" ? (
    <Hash className="h-4 w-4 shrink-0" />
  ) : (
    <MessageCircle className="h-4 w-4 shrink-0" />
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

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [sending, startSending] = useTransition();
  const [creatingDm, startCreatingDm] = useTransition();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Reset local messages whenever the active thread changes (or initial set
  // changes due to a server refresh). React 19's compiler flags the
  // setState-in-effect here; the idiomatic alternative is `key={activeThreadId}`
  // on the parent to force remount, but that also loses transitions. Intentional.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(initialMessages);
  }, [initialMessages, activeThreadId]);

  // Scroll to bottom whenever the message list changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Realtime subscription scoped to the active thread.
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
        async (payload) => {
          const row = payload.new as {
            id: string;
            thread_id: string;
            sender_id: string | null;
            body: string;
            created_at: string;
          };
          // Drop duplicates if the optimistic insert already added it.
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            // Best-effort sender name lookup from the threads list members
            // is unavailable here, so leave it null and the UI falls back
            // to "Teammate".
            return [
              ...prev,
              {
                id: row.id,
                thread_id: row.thread_id,
                sender_id: row.sender_id,
                sender_name: null,
                body: row.body,
                created_at: row.created_at,
              },
            ];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeThreadId]);

  function selectThread(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("thread", id);
    router.push(`${pathname}?${next.toString()}`);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeThreadId) return;
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    startSending(async () => {
      const res = await sendChatMessageAction(activeThreadId, body);
      if (!res.ok) {
        toast.error(res.error);
        setDraft(body);
        return;
      }
      // Refresh server data so sender name + persisted state are up to date.
      router.refresh();
    });
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

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const isMobile = variant === "mobile";

  // On mobile we collapse to a single pane: thread list OR active thread.
  const showThreadList = !isMobile || !activeThread;
  const showThreadPane = !isMobile || !!activeThread;

  return (
    <div
      className={cn(
        "flex w-full",
        isMobile
          ? "min-h-[calc(100vh-12rem)] flex-col"
          : "h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-border bg-card",
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
              {teammates.length === 0 ? (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                  No teammates yet. When the owner invites or adds
                  another member, they&rsquo;ll show up here to DM.
                </p>
              ) : (
                <FormSelect
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                >
                  <option value="">Pick a teammate…</option>
                  {teammates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </FormSelect>
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
                  {teammates.length === 0 ? "Close" : "Cancel"}
                </Button>
                {teammates.length > 0 && (
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
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectThread(t.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <ThreadIcon kind={t.kind} />
                      <span className="truncate">{t.display_name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>
      )}

      {showThreadPane && (
        <section className="flex min-w-0 flex-1 flex-col">
          {activeThread ? (
            <>
              <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => router.push(basePath)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </button>
                )}
                <ThreadIcon kind={activeThread.kind} />
                <span className="truncate text-sm font-semibold">
                  {activeThread.display_name}
                </span>
              </header>

              <div
                ref={scrollerRef}
                className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
              >
                {messages.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground">
                    No messages yet. Say hi.
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === currentMembershipId;
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex",
                          mine ? "justify-end" : "justify-start",
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                            mine
                              ? "bg-foreground text-background"
                              : "bg-muted text-foreground",
                          )}
                        >
                          {!mine && (
                            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                              {m.sender_name ?? "Teammate"}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words">
                            {m.body}
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-[10px] tabular-nums",
                              mine ? "opacity-70" : "text-muted-foreground",
                            )}
                          >
                            {formatTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 border-t border-border bg-background/60 px-3 py-3"
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
                    // On mobile, scroll the input into view after the keyboard opens
                    setTimeout(() => {
                      e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 300);
                  }}
                  placeholder="Type a message…"
                  rows={1}
                  className="flex max-h-32 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || draft.trim().length === 0}
                  aria-label="Send"
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
