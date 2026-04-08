"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  Clock,
  GraduationCap,
  MessageSquare,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type FieldNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const FIELD_NAV: FieldNavItem[] = [
  { href: "/field/jobs", label: "Jobs", icon: Briefcase },
  { href: "/field/clock", label: "Clock", icon: Clock },
  { href: "/field/training", label: "Training", icon: GraduationCap },
  { href: "/field/chat", label: "Chat", icon: MessageSquare },
  { href: "/field/profile", label: "Profile", icon: UserRound },
];

/**
 * Mobile-first shell for the employee field app. A sticky header with the
 * org name + sign-out, and a fixed bottom tab bar so cleaners can switch
 * sections one-handed on a phone.
 */
export function FieldShell({
  organizationName,
  userName,
  children,
}: {
  organizationName: string;
  userName: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold shadow-sm">
            S3
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">
              {organizationName}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {userName ?? "Field crew"}
            </span>
          </div>
        </div>
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
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
                    "flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5",
                      active && "text-primary",
                    )}
                  />
                  <span
                    className={cn(active && "font-semibold text-foreground")}
                  >
                    {item.label}
                  </span>
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
 * A friendly section header that mirrors PageShell but is tuned for the
 * tighter mobile field app.
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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
