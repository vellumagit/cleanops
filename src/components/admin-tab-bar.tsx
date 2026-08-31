"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, LogOut, Monitor, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MOBILE_TABS,
  NAV_SECTIONS,
  FOOTER_NAV,
  navItemVisible,
  bestNavMatch,
  allNavHrefs,
  type NavItem,
} from "@/components/app-nav";
import type { CapabilityMap } from "@/lib/capabilities";

/**
 * Bottom tab bar for the admin app on phones — the "app, not website"
 * layer. Four core destinations plus More, which opens a sheet holding
 * everything else from the nav manifest: the phone-friendly pages as
 * rows, and the desktop-shaped ones collapsed under "Desktop tools"
 * (reachable, just not front-line — see app-nav.ts).
 *
 * Same pattern as the field app's bottom nav, including the safe-area
 * inset for gesture-nav phones.
 */
export function AdminTabBar({
  role,
  capabilities = null,
  tabBadges = {},
  unreadNotifications = 0,
  feedEnabled = false,
}: {
  role: string;
  capabilities?: CapabilityMap;
  tabBadges?: Record<string, number>;
  unreadNotifications?: number;
  feedEnabled?: boolean;
}) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close the sheet on navigation — same idiom as the sidebar drawer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheetOpen(false);
  }, [pathname]);

  // Body scroll lock while the sheet is up.
  useEffect(() => {
    if (sheetOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [sheetOpen]);

  const visible = (item: NavItem) =>
    navItemVisible(item, role, capabilities, feedEnabled);

  const tabs = MOBILE_TABS.filter(visible);
  const activeHref = bestNavMatch(pathname, allNavHrefs());
  const tabHrefs = new Set(tabs.map((t) => t.href));
  // More is "active" when the current page lives in the sheet, so the
  // bar always shows where you are.
  const moreActive = !!activeHref && !tabHrefs.has(activeHref);

  // Sheet contents from the manifest: phone-tier rows grouped by their
  // sections, then the desktop tier collapsed at the bottom.
  const moreSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (i) => i.mobileTier === "more" && visible(i),
    ),
  })).filter((s) => s.items.length > 0);
  const footerMore = FOOTER_NAV.filter(
    (i) => i.mobileTier === "more" && visible(i),
  );
  const desktopTools = [
    ...NAV_SECTIONS.flatMap((s) => s.items),
    ...FOOTER_NAV,
  ].filter((i) => i.mobileTier === "desktop" && visible(i));

  function badgeFor(item: NavItem): number {
    if (item.href === "/app/notifications") return unreadNotifications;
    return tabBadges[item.href] ?? 0;
  }

  // Counts living inside the sheet (chat, notifications, leads, tasks…)
  // would be invisible until it's opened — roll them up onto More itself.
  const moreBadge = [
    ...moreSections.flatMap((s) => s.items),
    ...footerMore,
    ...desktopTools,
  ].reduce((sum, item) => sum + badgeFor(item), 0);

  function SheetRow({ item }: { item: NavItem }) {
    const Icon = item.icon;
    const badge = badgeFor(item);
    const active = activeHref === item.href;
    return (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-foreground/90 active:bg-muted",
        )}
      >
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{item.label}</span>
        {badge > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <>
      {/* ── The bar ── */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="flex items-stretch">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeHref === tab.href;
            const badge = tabBadges[tab.href] ?? 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground tabular-nums">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              moreActive || sheetOpen ? "text-primary" : "text-muted-foreground",
            )}
            aria-label="More"
          >
            <span className="relative">
              <Ellipsis className="h-5 w-5" />
              {moreBadge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground tabular-nums">
                  {moreBadge > 99 ? "99+" : moreBadge}
                </span>
              )}
            </span>
            More
          </button>
        </div>
      </nav>

      {/* ── The More sheet ── */}
      {sheetOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <h2 className="text-sm font-semibold">Everything else</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-md p-2 text-muted-foreground active:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {moreSections.map((section) => (
                <div key={section.label} className="mb-3">
                  <p className="mb-1 flex items-center gap-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        section.accent.replace("text-", "bg-"),
                      )}
                    />
                    {section.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {section.items.map((item) => (
                      <SheetRow key={item.href} item={item} />
                    ))}
                  </div>
                </div>
              ))}

              <div className="mb-3 grid grid-cols-2 gap-1">
                {footerMore.map((item) => (
                  <SheetRow key={item.href} item={item} />
                ))}
              </div>

              {/* Desktop-shaped pages: reachable, not front-line. */}
              {desktopTools.length > 0 && (
                <details className="rounded-lg border border-border/70">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                    <Monitor className="h-4 w-4" />
                    Desktop tools
                    <span className="ml-auto text-[11px] font-normal">
                      easier at a desk
                    </span>
                  </summary>
                  <div className="grid grid-cols-2 gap-1 border-t border-border/70 p-1.5">
                    {desktopTools.map((item) => (
                      <SheetRow key={item.href} item={item} />
                    ))}
                  </div>
                </details>
              )}

              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                <Link
                  href="/field/jobs"
                  className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground active:bg-muted"
                >
                  <Smartphone className="h-4 w-4" />
                  Field view
                </Link>
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground active:bg-muted"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
