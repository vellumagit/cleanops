import { LogOut } from "lucide-react";
import { ClientTabBar } from "./tab-bar";
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
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground"
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

      <ClientTabBar />
    </div>
  );
}
