import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { bookingPageFor, pageServices, type BookingPage, type PageService } from "@/lib/booking-page";
import { nameProblem, tidyName } from "@/lib/booking-page-rules";
import { formatCurrencyCents } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { OnlineBookingForm } from "./online-booking-form";

export const metadata = { title: "Online booking" };

/**
 * Settings, Online booking. A company has no booking page until it makes
 * one here: claim the name, build it as a draft, preview it, publish it
 * (docs/online-booking-roadmap.md, "Nothing is created automatically").
 */
export default async function OnlineBookingPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const orgId = membership.organization_id;

  // Read on their own, so the page still opens (as "not set up") on a
  // database that doesn't have the table yet.
  let page: BookingPage | null = null;
  let services: PageService[] = [];
  let ready = true;
  try {
    [page, services] = await Promise.all([bookingPageFor(orgId), pageServices(orgId)]);
  } catch (err) {
    console.error("[online-booking] could not read the page:", err);
    ready = false;
  }

  const [currency, orgRow] = await Promise.all([
    getOrgCurrency(orgId),
    createSupabaseAdminClient().from("organizations").select("slug, name").eq("id", orgId).maybeSingle() as unknown as Promise<{
      data: { slug: string | null; name: string | null } | null;
    }>,
  ]);
  // A starting suggestion only: the company's name, tidied. Theirs to change.
  const fromName = tidyName(orgRow.data?.name ?? "");
  const suggestion = !nameProblem(fromName) ? fromName : "";
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com").replace(/\/$/, "");

  return (
    <PageShell
      title="Online booking"
      description="Your own page for clients: a link you can put on your website, your cards and your messages."
      actions={
        <Link href="/app/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      {!ready ? (
        <p className="max-w-2xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Online booking isn&rsquo;t available yet on this account. Try again in a few minutes.
        </p>
      ) : (
        <OnlineBookingForm
          site={site}
          page={page}
          suggestion={suggestion}
          services={services.map((s) => ({
            id: s.id,
            name: s.name,
            price: s.default_price_cents != null && s.default_price_cents > 0 ? formatCurrencyCents(s.default_price_cents, currency) : null,
            show: s.show_on_booking_page,
            priceMode: s.booking_page_price,
          }))}
        />
      )}
    </PageShell>
  );
}
