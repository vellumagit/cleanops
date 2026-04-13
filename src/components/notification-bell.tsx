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
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm shadow-red-500/30 animate-in fade-in">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
