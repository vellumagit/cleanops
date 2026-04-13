"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Star,
  Package,
  CalendarClock,
  Bell,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "./actions";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  review_request: Star,
  low_inventory: Package,
  unfilled_shift: CalendarClock,
  general: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  review_request: "text-amber-500",
  low_inventory: "text-red-500",
  unfilled_shift: "text-blue-500",
  general: "text-slate-400",
};

export function NotificationList({
  notifications,
}: {
  notifications: Notification[];
}) {
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Bell className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">
          No notifications yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          You&apos;ll see alerts for paid invoices, low inventory, and unfilled
          shifts here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
          </p>
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="ghost" size="sm" className="gap-1.5 text-xs">
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          </form>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {notifications.map((n) => {
          const Icon = TYPE_ICONS[n.type] ?? Bell;
          const iconColor = TYPE_COLORS[n.type] ?? "text-slate-400";
          const isUnread = !n.read_at;

          return (
            <li
              key={n.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3 transition-colors",
                isUnread ? "bg-card" : "bg-muted/20 opacity-70",
              )}
            >
              {n.href ? (
                <Link href={n.href} className="flex min-w-0 flex-1 items-start gap-3 hover:opacity-80">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      isUnread ? "bg-muted" : "bg-muted/50",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", iconColor)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>
                        {n.title}
                      </p>
                      {isUnread && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground/60">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </Link>
              ) : (
                <>
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      isUnread ? "bg-muted" : "bg-muted/50",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", iconColor)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>
                        {n.title}
                      </p>
                      {isUnread && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground/60">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </>
              )}
              {isUnread && (
                <form action={markNotificationReadAction.bind(null, n.id)}>
                  <button
                    type="submit"
                    className="mt-1 rounded p-1 text-muted-foreground/40 hover:bg-muted hover:text-foreground"
                    title="Mark as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
