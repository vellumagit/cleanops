"use client";

import { hasCapability, type CapabilityKey, type CapabilityMap } from "@/lib/capabilities";
import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Command } from "cmdk";
import {
  CalendarPlus,
  UserPlus,
  FileText,
  Receipt,
  Users,
  CalendarDays,
  ClipboardList,
  CheckSquare,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OPEN_QUICK_ACTIONS_EVENT } from "@/components/top-bar-actions";

type Action = {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords?: string;
  /** Hide the shortcut from managers whose capability toggle is off — a
   *  shortcut to a page that bounces you is worse than no shortcut. */
  capability?: CapabilityKey;
};

const ACTIONS: Action[] = [
  {
    id: "new-booking",
    label: "New booking",
    description: "Schedule a job for your team",
    icon: CalendarPlus,
    href: "/app/bookings/new",
    keywords: "job schedule create",
  },
  {
    id: "new-client",
    capability: "clients" as CapabilityKey,
    label: "New client",
    description: "Add a client to your roster",
    icon: UserPlus,
    href: "/app/clients/new",
    keywords: "customer add",
  },
  {
    id: "new-estimate",
    capability: "invoicing" as CapabilityKey,
    label: "New estimate",
    description: "Send a quote to a lead",
    icon: FileText,
    href: "/app/estimates/new",
    keywords: "quote proposal",
  },
  {
    id: "new-invoice",
    capability: "invoicing" as CapabilityKey,
    label: "New invoice",
    description: "Bill a client",
    icon: Receipt,
    href: "/app/invoices/new",
    keywords: "bill payment",
  },
  {
    id: "go-calendar",
    capability: "scheduling" as CapabilityKey,
    label: "Open calendar",
    description: "View your schedule",
    icon: CalendarDays,
    href: "/app/calendar",
    keywords: "schedule view",
  },
  {
    id: "go-clients",
    capability: "clients" as CapabilityKey,
    label: "Clients",
    icon: Users,
    href: "/app/clients",
    keywords: "customers list",
  },
  {
    id: "go-scheduling",
    capability: "scheduling" as CapabilityKey,
    label: "Scheduling / dispatch",
    icon: ClipboardList,
    href: "/app/scheduling",
    keywords: "dispatch assign crew",
  },
  {
    id: "new-task",
    label: "New task",
    description: "Add a to-do or reminder",
    icon: CheckSquare,
    href: "/app/tasks/new",
    keywords: "todo reminder due date",
  },
];

export function QuickActions({
  role,
  capabilities = null,
  /** When the AI assistant widget is also on screen (bottom-right), lift
   *  this button so the two stack vertically instead of overlapping. */
  hasAssistant = false,
}: {
  role: string;
  capabilities?: CapabilityMap | null;
  hasAssistant?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Same rule as the sidebar: a shortcut to a page that will bounce you is
  // worse than no shortcut. Items without a capability stay for everyone the
  // role filter admits.
  const actions = ACTIONS.filter(
    (a) => !a.capability || hasCapability(role as never, capabilities, a.capability),
  ).filter(
    (a) =>
      !["new-estimate", "new-invoice", "go-scheduling", "new-task"].includes(a.id) ||
      ["owner", "admin", "manager"].includes(role),
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  // The phone top bar's "+" (TopBarActions) opens the same palette.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_QUICK_ACTIONS_EVENT, show);
    return () => window.removeEventListener(OPEN_QUICK_ACTIONS_EVENT, show);
  }, []);

  function run(href: string) {
    setOpen(false);
    setSearch("");
    router.push(href);
  }

  // Chat owns its bottom edge — it is a full-height surface with a composer
  // pinned there, and this button sat on top of the message list and the
  // input. Only the BUTTON goes; the palette below still renders, so Cmd+K
  // keeps working on chat exactly as it does everywhere else.
  const onChat = pathname.startsWith("/app/chat");

  return (
    <>
      {/* Floating "+" button — desktop only. On phones it covered the
          bottom-right of every page; the top bar's "+" (TopBarActions)
          replaces it there. */}
      {!onChat && (
        <button
          type="button"
          onClick={toggle}
          title="Quick actions (⌘K)"
          className={cn(
            "fixed z-40 hidden h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform active:scale-95 lg:flex",
            // Stack above the AI assistant button when present.
            hasAssistant ? "bottom-20 right-5" : "bottom-6 right-4",
          )}
          aria-label="Quick actions"
        >
          {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      )}

      {/* Backdrop + palette */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <div className="fixed left-1/2 top-[15vh] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
            <Command shouldFilter={false} className="flex flex-col">
              {/* Search input */}
              <div className="flex items-center gap-2 border-b border-border px-3">
                <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="What do you want to do?"
                  autoFocus
                  className="flex-1 bg-transparent py-3.5 text-sm placeholder:text-muted-foreground focus:outline-none"
                />
                <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-72 overflow-y-auto py-2">
                <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                  No matching action
                </Command.Empty>

                {actions
                  .filter((a) => {
                    if (!search) return true;
                    const q = search.toLowerCase();
                    return (
                      a.label.toLowerCase().includes(q) ||
                      (a.description ?? "").toLowerCase().includes(q) ||
                      (a.keywords ?? "").toLowerCase().includes(q)
                    );
                  })
                  .map((a) => {
                    const Icon = a.icon;
                    return (
                      <Command.Item
                        key={a.id}
                        value={a.id}
                        onSelect={() => run(a.href)}
                        className="mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{a.label}</p>
                          {a.description && (
                            <p className="truncate text-xs text-muted-foreground">
                              {a.description}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    );
                  })}
              </Command.List>

              <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">↑↓</kbd> navigate ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">↵</kbd> select ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5">⌘K</kbd> toggle
              </div>
            </Command>
          </div>
        </>
      )}
    </>
  );
}
