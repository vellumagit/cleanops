"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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

type Action = {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords?: string;
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
    label: "New client",
    description: "Add a client to your roster",
    icon: UserPlus,
    href: "/app/clients/new",
    keywords: "customer add",
  },
  {
    id: "new-estimate",
    label: "New estimate",
    description: "Send a quote to a lead",
    icon: FileText,
    href: "/app/estimates/new",
    keywords: "quote proposal",
  },
  {
    id: "new-invoice",
    label: "New invoice",
    description: "Bill a client",
    icon: Receipt,
    href: "/app/invoices/new",
    keywords: "bill payment",
  },
  {
    id: "go-calendar",
    label: "Open calendar",
    description: "View your schedule",
    icon: CalendarDays,
    href: "/app/calendar",
    keywords: "schedule view",
  },
  {
    id: "go-clients",
    label: "Clients",
    icon: Users,
    href: "/app/clients",
    keywords: "customers list",
  },
  {
    id: "go-scheduling",
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
  /** When the AI assistant widget is also on screen (bottom-right), lift
   *  this button so the two stack vertically instead of overlapping. */
  hasAssistant = false,
}: {
  role: string;
  hasAssistant?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const actions = ACTIONS.filter(
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

  function run(href: string) {
    setOpen(false);
    setSearch("");
    router.push(href);
  }

  return (
    <>
      {/* Floating "+" button — bottom-right on mobile, hidden on desktop
          (on desktop users use Cmd+K or the sidebar links). */}
      <button
        type="button"
        onClick={toggle}
        title="Quick actions (⌘K)"
        className={cn(
          "fixed z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform active:scale-95 lg:h-10 lg:w-10",
          // Stack above the AI assistant button (bottom-5, 48px tall) when
          // present; otherwise sit in the normal bottom-right FAB slot.
          hasAssistant
            ? "bottom-24 right-5 lg:bottom-20"
            : "bottom-24 right-4 lg:bottom-6",
        )}
        aria-label="Quick actions"
      >
        {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      </button>

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
