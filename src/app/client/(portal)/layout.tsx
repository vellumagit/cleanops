import { LogOut } from "lucide-react";
import { ClientTabBar } from "./tab-bar";
import { getCurrentClient } from "@/lib/client-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientBookingOffer } from "@/lib/booking-page";

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

  // The company's phone number, for anyone who would rather talk to a
  // person. Read past RLS (a client can't read organizations) and only
  // this one field. Never worth failing the page over.
  let phone: string | null = null;
  // Whether New clean opens the time picker or the request form. Read
  // beside the phone; a failure means the request form, as before.
  const canBookPromise = client ? clientBookingOffer(client.organization_id).then(Boolean) : Promise.resolve(false);
  if (client) {
    try {
      const { data } = (await createSupabaseAdminClient()
        .from("organizations")
        .select("contact_phone" as never)
        .eq("id", client.organization_id)
        .maybeSingle()) as unknown as { data: { contact_phone: string | null } | null };
      phone = data?.contact_phone?.trim() || null;
    } catch {
      phone = null;
    }
  }

  // If we rendered this layout, the viewer is authenticated as a
  // client. Children still call requireClient for belt-and-braces.
  return (
    <div className="flex min-h-[100dvh] flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b border-border bg-card px-4 py-3 supports-[backdrop-filter]:bg-card/80 supports-[backdrop-filter]:backdrop-blur supports-[padding-top:env(safe-area-inset-top)]:pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          {/* The cleaner's own name. A client knows their cleaner; "client
              portal" and "Sollos" mean nothing to them. */}
          <span className="min-w-0 truncate text-base font-semibold">
            {client?.organization_name ?? "—"}
          </span>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5">
        {children}
        {phone && client && (
          <p className="mt-8 border-t border-border pt-4 text-base text-muted-foreground">
            Rather talk to someone? Call {client.organization_name} at{" "}
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-foreground underline underline-offset-4">
              {phone}
            </a>
            .
          </p>
        )}
      </main>

      <ClientTabBar canBook={await canBookPromise} />
    </div>
  );
}
