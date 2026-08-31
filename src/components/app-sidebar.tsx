"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rocket, LogOut, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notification-bell";
import { type CapabilityMap } from "@/lib/capabilities";
import {
  NAV_SECTIONS,
  FOOTER_NAV,
  BADGE_LABELS,
  navItemVisible,
  bestNavMatch,
} from "@/components/app-nav";

/**
 * Sollos 3 ops-console sidebar. Desktop (lg+) renders the fixed sidebar;
 * mobile gets only the slim top bar — navigation on phones lives in the
 * bottom AdminTabBar + its More sheet, both fed by the SAME manifest
 * (src/components/app-nav.ts), so the two surfaces cannot drift.
 */

type Props = {
  organizationName: string;
  role: string;
  /** Per-manager capability switches; see src/lib/capabilities.ts. */
  capabilities?: CapabilityMap;
  userName: string | null;
  showSetup?: boolean;
  logoUrl?: string | null;
  brandColor?: string | null;
  unreadNotifications?: number;
  /** Per-tab badge counts, keyed by href (e.g. "/app/bookings": 3) */
  tabBadges?: Record<string, number>;
  /** Per-org feed feature toggle. When false, the Feed nav link is
   *  removed entirely from the Comms section. Default off matches the
   *  feed_visible automation default. */
  feedEnabled?: boolean;
};

export function AppSidebar({
  organizationName,
  role,
  capabilities = null,
  userName,
  showSetup,
  logoUrl,
  brandColor,
  unreadNotifications = 0,
  tabBadges = {},
  feedEnabled = false,
}: Props) {
  const pathname = usePathname();

  // Shared visibility rule (feed toggle + capability + role) — the same
  // one the tab bar and More sheet apply, so no surface ever shows a
  // link another hides.
  const visibleNavSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      navItemVisible(item, role, capabilities, feedEnabled),
    ),
  }));

  const bestMatch = bestNavMatch(pathname, [
    ...visibleNavSections.flatMap((s) => s.items.map((i) => i.href)),
    ...FOOTER_NAV.map((i) => i.href),
  ]);
  const isActive = (href: string) => href === bestMatch;

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
      <nav className="sollos-scroll flex-1 overflow-y-auto px-3 py-3">
        {visibleNavSections.map((section) => {
          const visibleItems = section.items;
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

        {/* Switch to Field View — owners/admins/managers who also clean */}
        <Link
          href="/field/jobs"
          className="mb-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200 lg:py-1.5"
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">Switch to Field View</span>
        </Link>

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

        {role !== "employee" && (
          <>
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              Sollos 3 · v1.0
            </p>
            <p className="text-center text-[9px] text-zinc-600">
              Powered by{" "}
              <a
                href="https://velluma.co"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-400"
              >
                Velluma
              </a>
            </p>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile top bar (visible below lg). No hamburger: navigation on
          phones is the bottom tab bar + its More sheet. ── */}
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
        <NotificationBell count={unreadNotifications} />
      </div>

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="hidden h-screen w-56 shrink-0 flex-col bg-zinc-900 text-zinc-400 lg:flex">
        {sidebarContent}
      </aside>
    </>
  );
}
