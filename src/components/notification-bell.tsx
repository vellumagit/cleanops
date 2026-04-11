"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

export function NotificationBell({ count }: { count: number }) {
  return (
    <Link
      href="/app/notifications"
      className="relative rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      aria-label={
        count > 0
          ? `${count} unread notification${count !== 1 ? "s" : ""}`
          : "Notifications"
      }
    >
      <Bell className="h-3.5 w-3.5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-zinc-100 px-0.5 text-[9px] font-bold text-zinc-900">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
