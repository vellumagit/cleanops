"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationBell({ count }: { count: number }) {
  return (
    <Link
      href="/app/notifications"
      className={cn(
        "relative rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100",
      )}
      aria-label={
        count > 0
          ? `${count} unread notification${count !== 1 ? "s" : ""}`
          : "Notifications"
      }
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
