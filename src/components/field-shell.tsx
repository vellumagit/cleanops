"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Clock,
  MessageSquare,
  Rss,
  UserRound,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PwaInstallBanner } from "@/components/pwa-install-banner";

type FieldNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const FIELD_NAV: FieldNavItem[] = [
  { href: "/field/jobs", label: "Jobs", icon: Briefcase },
  { href: "/field/clock", label: "Clock", icon: Clock },
  { href: "/field/feed", label: "Feed", icon: Rss },
  { href: "/field/chat", label: "Chat", icon: MessageSquare },
  { href: "/field/profile", label: "Profile", icon: UserRound },
];

/**
 * Mobile-first shell for the employee field app. A sticky header with the
 * org name + sign-out, and a fixed bottom tab bar so cleaners can switch
 * sections one-handed on a phone.
 *
 * Brand colour flows via CSS custom properties from BrandProvider (--brand,
 * --brand-rgb) and is used for the active nav tab, header accent, and logo.
 */
export function FieldShell({
  organizationName,
  userName,
  logoUrl,
  brandColor,
  role,
  children,
}: {
  organizationName: string;
  userName: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  /** Membership role — owners/admins/managers get a "Back to Dashboard" link */
  role?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      {/* ── Sticky header ── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/80 px-4 py-3 backdrop-blur supports-[padding-top:env(safe-area-inset-top)]:pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{
          borderBottomColor: brandColor
            ? `rgba(var(--brand-rgb), 0.25)`
            : undefined,
          borderBottomWidth: brandColor ? "2px" : undefined,
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl || "/sollos-logo.png"}
            alt={organizationName}
            className="h-9 w-9 shrink-0 rounded-lg object-contain"
          />
          <div className="flex min-w-0 flex-col leading-snug">
            <span className="truncate text-[15px] font-semibold">
              {organizationName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {userName ?? "Field crew"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Back to Dashboard — only for owners / admins / managers */}
          {role && role !== "employee" && (
            <Link
              href="/app"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          )}
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <PwaInstallBanner />

      {/* ── Main content ── */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-5">
        {children}
      </main>

      {/* ── Bottom tab bar ── */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-2xl">
          {FIELD_NAV.map((item) => {
            const active =
              item.href === "/field"
                ? pathname === "/field"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  prefetch={false}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
                    active
                      ? "text-primary"
                      : "text-muted-foreground active:text-foreground",
                  )}
                  style={
                    active && brandColor
                      ? { color: `var(--brand)` }
                      : undefined
                  }
                >
                  <Icon
                    className={cn(
                      "h-6 w-6",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                    style={
                      active && brandColor
                        ? { color: `var(--brand)` }
                        : undefined
                    }
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/**
 * A friendly section header tuned for the mobile field app.
 */
export function FieldHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
