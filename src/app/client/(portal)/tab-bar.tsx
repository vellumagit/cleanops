"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Home, Receipt, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The portal's bottom tab bar.
 *
 * Previously a set of server-rendered links styled only with
 * `hover:text-foreground`. Hover does not exist on a touchscreen, so tapping a
 * tab produced no visual response whatsoever, and the bar never showed which
 * tab you were on. Every click "felt dead" because, on a phone, nothing
 * happened.
 *
 * Three things now answer a tap:
 *   - `active:` styling fires on touchdown, before any navigation begins.
 *   - The current route is marked, so arriving somewhere is visible.
 *   - useLinkStatus drives a per-tab progress bar for the gap between tap and
 *     new screen. Per the Next docs it must be rendered INSIDE the <Link> whose
 *     status it reports, which is why TabProgress is a separate component.
 */

const NAV = [
  { href: "/client", label: "Home", icon: Home },
  { href: "/client/jobs", label: "Jobs", icon: Briefcase },
  { href: "/client/request", label: "Request", icon: CalendarPlus },
  { href: "/client/invoices", label: "Invoices", icon: Receipt },
];

/** Indeterminate bar across the top of the tab that was tapped. */
function TabProgress() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-x-2 top-0 h-0.5 overflow-hidden rounded-full bg-primary/20"
    >
      <span className="tap-progress block h-full w-1/3 rounded-full bg-primary" />
    </span>
  );
}

export function ClientTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-3xl">
        {NAV.map((item) => {
          const Icon = item.icon;
          // /client must match exactly or it lights up on every child route.
          const isActive =
            item.href === "/client"
              ? pathname === "/client"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
                  "transition-colors duration-100",
                  // The pressed state is the whole point: it fires on
                  // touchdown, so the tap is acknowledged before the network
                  // is involved at all.
                  "active:bg-primary/10",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground active:text-foreground",
                )}
              >
                <TabProgress />
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform duration-100",
                    "active:scale-90",
                  )}
                />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
