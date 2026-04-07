"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  FileText,
  ScrollText,
  Users,
  UserRound,
  Star,
  Receipt,
  Package,
  GraduationCap,
  Boxes,
  MessageSquare,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/bookings", label: "Bookings", icon: Calendar },
  { href: "/app/scheduling", label: "Scheduling", icon: CalendarCheck },
  { href: "/app/estimates", label: "Estimates", icon: FileText },
  { href: "/app/contracts", label: "Contracts", icon: ScrollText },
  { href: "/app/clients", label: "Clients", icon: Users },
  { href: "/app/employees", label: "Employees", icon: UserRound },
  { href: "/app/reviews", label: "Reviews", icon: Star },
  { href: "/app/invoices", label: "Invoices", icon: Receipt },
  { href: "/app/packages", label: "Packages", icon: Package },
  { href: "/app/training", label: "Training", icon: GraduationCap },
  { href: "/app/inventory", label: "Inventory", icon: Boxes },
  { href: "/app/chat", label: "Chat", icon: MessageSquare },
];

const FOOTER_NAV: NavItem[] = [
  { href: "/app/settings", label: "Settings", icon: Settings },
];

type Props = {
  organizationName: string;
  role: string;
  userName: string | null;
};

export function AppSidebar({ organizationName, role, userName }: Props) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background text-xs font-semibold">
          CO
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight">
            {organizationName}
          </span>
          <span className="truncate text-[11px] text-muted-foreground leading-tight">
            CleanOps
          </span>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === "/app"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer nav + user */}
      <div className="border-t border-border px-2 py-3">
        <ul className="mb-2 space-y-0.5">
          {FOOTER_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {(userName ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium leading-tight">
              {userName ?? "You"}
            </span>
            <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
              {role}
            </span>
          </div>
          <Link
            href="/auth/logout"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
