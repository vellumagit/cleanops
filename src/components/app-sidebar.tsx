"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileText,
  ScrollText,
  Users,
  UserRound,
  UserPlus,
  Star,
  Award,
  Receipt,
  Package,
  GraduationCap,
  Boxes,
  MessageSquare,
  Rss,
  Rocket,
  Settings,
  LogOut,
  Bell,
  BarChart3,
  Banknote,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";

/**
 * Sollos 3 ops-console sidebar — responsive: hamburger on mobile,
 * fixed sidebar on desktop (lg+).
 *
 * Now with per-section colour coding and per-tab notification badges.
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Roles that can see this item. If omitted, visible to all. */
  roles?: string[];
};

type NavSection = {
  label: string;
  items: NavItem[];
  /** Accent colour for this section's icons */
  accent: string;
  /** Active tab background tint */
  activeBg: string;
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    accent: "text-zinc-300",
    activeBg: "bg-zinc-800",
    items: [{ href: "/app", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    accent: "text-sky-400",
    activeBg: "bg-sky-500/10",
    items: [
      { href: "/app/bookings", label: "Bookings", icon: CalendarCheck },
      { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/app/scheduling", label: "Scheduling", icon: Calendar, roles: ["owner", "admin", "manager"] },
      { href: "/app/estimates", label: "Estimates", icon: FileText, roles: ["owner", "admin", "manager"] },
      { href: "/app/contracts", label: "Contracts", icon: ScrollText, roles: ["owner", "admin", "manager"] },
      { href: "/app/packages", label: "Packages", icon: Package, roles: ["owner", "admin", "manager"] },
      { href: "/app/inventory", label: "Inventory", icon: Boxes },
    ],
  },
  {
    label: "People",
    accent: "text-violet-400",
    activeBg: "bg-violet-500/10",
    items: [
      { href: "/app/clients", label: "Clients", icon: Users, roles: ["owner", "admin", "manager"] },
      { href: "/app/employees", label: "Employees", icon: UserRound, roles: ["owner", "admin"] },
      { href: "/app/timesheets", label: "Timesheets", icon: Clock, roles: ["owner", "admin", "manager"] },
      { href: "/app/freelancers", label: "Freelancer bench", icon: UserPlus, roles: ["owner", "admin"] },
      { href: "/app/reviews", label: "Reviews", icon: Star },
      { href: "/app/bonuses", label: "Bonuses", icon: Award },
      { href: "/app/training", label: "Training", icon: GraduationCap },
    ],
  },
  {
    label: "Money",
    accent: "text-emerald-400",
    activeBg: "bg-emerald-500/10",
    items: [
      { href: "/app/invoices", label: "Invoices", icon: Receipt, roles: ["owner", "admin", "manager"] },
      { href: "/app/reports", label: "Reports", icon: BarChart3, roles: ["owner", "admin"] },
      { href: "/app/payroll", label: "Payroll", icon: Banknote, roles: ["owner", "admin"] },
    ],
  },
  {
    label: "Comms",
    accent: "text-amber-400",
    activeBg: "bg-amber-500/10",
    items: [
      { href: "/app/feed", label: "Feed", icon: Rss },
      { href: "/app/chat", label: "Chat", icon: MessageSquare },
    ],
  },
];

const FOOTER_NAV: NavItem[] = [
  { href: "/app/notifications", label: "Notifications", icon: Bell },
  { href: "/app/settings", label: "Settings", icon: Settings, roles: ["owner", "admin"] },
];

/** Badge labels for specific tabs */
const BADGE_LABELS: Record<string, string> = {
  "/app/bookings": "today",
  "/app/invoices": "overdue",
  "/app/estimates": "pending",
  "/app/chat": "new",
  "/app/reviews": "this week",
};

type Props = {
  organizationName: string;
  role: string;
  userName: string | null;
  showSetup?: boolean;
  logoUrl?: string | null;
  brandColor?: string | null;
  unreadNotifications?: number;
  /** Per-tab badge counts, keyed by href (e.g. "/app/bookings": 3) */
  tabBadges?: Record<string, number>;
};

export function AppSidebar({
  organizationName,
  role,
  userName,
  showSetup,
  logoUrl,
  brandColor,
  unreadNotifications = 0,
  tabBadges = {},
}: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change. React 19's compiler flags the
  // setState-in-effect, but this is the idiomatic pattern — syncing
  // local UI state to an external routing event. The alternative
  // (listen to router events) is more invasive and doesn't change behavior.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  const sidebarContent = (
    <>
      {/* Brand header */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl || "/sollos-logo.png"}
          alt={organizationName}
          className={cn(
            "h-7 w-7 shrink-0 rounded-md object-contain",
            !logoUrl && "[filter:brightness(0)_invert(1)]",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold text-zinc-100">
            {logoUrl ? organizationName : "Sollos 3"}
          </span>
          <span className="truncate text-[10px] text-zinc-500">
            Cleaning operations hub
          </span>
        </div>
        <NotificationBell count={unreadNotifications} />
      </div>

      {/* Brand accent stripe */}
      {brandColor && (
        <div
          className="mx-3 h-0.5 rounded-full"
          style={{ backgroundColor: `#${brandColor}` }}
        />
      )}

      {/* Get started — vibrant gradient banner during onboarding */}
      {showSetup && (
        <div className="px-3 pt-3 pb-1">
          <Link
            href="/app/setup"
            className={cn(
              "group relative flex items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all",
              pathname === "/app/setup"
                ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25"
                : "bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-indigo-300 hover:from-indigo-500/30 hover:to-violet-500/30 hover:text-indigo-200",
            )}
          >
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md",
                pathname === "/app/setup"
                  ? "bg-white/20"
                  : "bg-indigo-500/30",
              )}
            >
              <Rocket className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1">
              <span className="block">Get started</span>
              <span
                className={cn(
                  "block text-[10px] font-normal",
                  pathname === "/app/setup"
                    ? "text-white/70"
                    : "text-indigo-400/70",
                )}
              >
                Set up your workspace
              </span>
            </div>
            {/* Animated sparkle */}
            <div className="absolute -right-1 -top-1 h-8 w-8 rounded-full bg-white/5 blur-md transition-opacity group-hover:opacity-100 opacity-0" />
          </Link>
        </div>
      )}

      {/* Divider */}
      <div className="mx-3 mt-2 border-t border-zinc-800/80" />

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(
            (item) => !item.roles || item.roles.includes(role),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label} className="mb-5 last:mb-0">
              {/* Section header with coloured dot */}
              <div className="mb-1.5 flex items-center gap-1.5 px-2">
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    section.accent.replace("text-", "bg-"),
                  )}
                />
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  {section.label}
                </p>
              </div>

              <ul className="space-y-px">
                {visibleItems.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  const badge = tabBadges[item.href] ?? 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-all lg:py-1.5 lg:text-[13px]",
                          active
                            ? `${section.activeBg} font-medium text-zinc-100`
                            : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                        )}
                        style={
                          active && brandColor
                            ? {
                                backgroundColor: `#${brandColor}22`,
                                color: `#${brandColor}`,
                              }
                            : undefined
                        }
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0 lg:h-3.5 lg:w-3.5",
                            active
                              ? brandColor
                                ? undefined
                                : section.accent
                              : "text-zinc-500",
                          )}
                        />
                        <span className="flex-1 truncate">{item.label}</span>

                        {/* Per-tab badge */}
                        {badge > 0 && (
                          <span
                            className={cn(
                              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                              active
                                ? "bg-white/15 text-zinc-100"
                                : "bg-zinc-800 text-zinc-400",
                            )}
                            title={`${badge} ${BADGE_LABELS[item.href] ?? ""}`}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800 px-3 py-3">
        <ul className="mb-2 space-y-px">
          {FOOTER_NAV.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            const isNotif = item.href === "/app/notifications";
            const badge = isNotif ? unreadNotifications : 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors lg:py-1.5 lg:text-[13px]",
                    active
                      ? "bg-zinc-800 font-medium text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                  )}
                  style={
                    active && brandColor
                      ? {
                          backgroundColor: `#${brandColor}22`,
                          color: `#${brandColor}`,
                        }
                      : undefined
                  }
                >
                  <Icon className="h-4 w-4 shrink-0 lg:h-3.5 lg:w-3.5" />
                  <span className="flex-1 truncate">{item.label}</span>

                  {/* Notification badge on the Notifications tab */}
                  {badge > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white tabular-nums">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* User card */}
        <div className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-2.5 py-2">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
            style={
              brandColor
                ? {
                    backgroundColor: `#${brandColor}33`,
                    color: `#${brandColor}`,
                    border: `1.5px solid #${brandColor}55`,
                  }
                : {
                    backgroundColor: "rgb(63 63 70)", // zinc-700
                    color: "rgb(212 212 216)", // zinc-300
                  }
            }
          >
            {(userName ?? "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[12px] font-medium text-zinc-200">
              {userName ?? "You"}
            </span>
            <span className="truncate text-[10px] text-zinc-500 capitalize">
              {role}
            </span>
          </div>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-300"
              aria-label="Sign out"
            >
              <LogOut className="h-3 w-3" />
            </button>
          </form>
        </div>

        <p className="mt-2 text-center text-[10px] text-zinc-600">
          Sollos 3 · v1.0
        </p>
        <p className="text-center text-[9px] text-zinc-600">
          Powered by{" "}
          <a
            href="https://velluma.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-400"
          >
            Velluma
          </a>
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar (visible below lg) ── */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-zinc-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl || "/sollos-logo.png"}
            alt={organizationName}
            className={cn(
              "h-7 w-7 shrink-0 rounded-md object-contain",
              !logoUrl && "[filter:brightness(0)_invert(1)]",
            )}
          />
          <span className="truncate text-sm font-semibold text-zinc-100">
            {logoUrl ? organizationName : "Sollos 3"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell count={unreadNotifications} />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* ── Mobile overlay + drawer ── */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-zinc-900 text-zinc-400 shadow-2xl lg:hidden">
            {/* Close button */}
            <div className="flex justify-end px-3 pt-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                aria-label="Close menu"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            {sidebarContent}
          </aside>
        </>
      )}

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="hidden h-screen w-56 shrink-0 flex-col bg-zinc-900 text-zinc-400 lg:flex">
        {sidebarContent}
      </aside>
    </>
  );
}
