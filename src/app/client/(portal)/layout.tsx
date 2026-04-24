import Link from "next/link";
import { Briefcase, Home, Receipt, LogOut, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentClient } from "@/lib/client-auth";

/**
 * Client portal shell. Top header with org name + logout, bottom tab
 * bar with Dashboard / Jobs / Invoices. Sign-in and claim pages bypass
 * this layout via their own route group — only post-auth pages here.
 *
 * Login and claim pages are siblings rather than children so they
 * skip the tab-bar header entirely.
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Soft-resolve the client so this layout works for both auth'd and
  // public pages within /client/* (children call requireClient() in
  // their own page if they need it). Login + claim pages live
  // alongside and use their own layouts to skip this shell.
  const client = await getCurrentClient();

  // If we rendered this layout, the viewer is authenticated as a
  // client. Children still call requireClient for belt-and-braces.
  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex min-w-0 flex-col leading-snug">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Client portal
            </span>
            <span className="truncate text-sm font-semibold">
              {client?.organization_name ?? "—"}
            </span>
          </div>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-3xl">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-xs font-medium",
                    "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
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

const NAV = [
  { href: "/client", label: "Home", icon: Home },
  { href: "/client/jobs", label: "Jobs", icon: Briefcase },
  { href: "/client/request", label: "Request", icon: CalendarPlus },
  { href: "/client/invoices", label: "Invoices", icon: Receipt },
];
