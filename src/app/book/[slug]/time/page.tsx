import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { canBookTime, publicBookingPage } from "@/lib/booking-page";
import { publicPrice } from "@/lib/booking-page-rules";
import { formatCurrencyCents, formatDurationMinutes } from "@/lib/format";
import { brandButtonColors } from "@/lib/readable-on";
import { onSiteMinutes } from "@/lib/open-times";
import { orgDividesCrewHours } from "@/lib/crew-hours";
import { TimePicker } from "./time-picker";

export const dynamic = "force-dynamic";

/**
 * "Book a clean": sollos3.com/book/<name>/time. A visitor picks a service,
 * a day and a time on the company's own page (roadmap phase 3).
 *
 * Exists only when the company switched time booking on and has at least
 * one service on its page with a length. Otherwise the visitor is sent back
 * to the company's page, where they can ask for a clean.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await publicBookingPage(slug).catch(() => null);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };
  return { title: `Book a clean with ${found.company.name}`, robots: found.preview ? { index: false, follow: false } : undefined };
}

export default async function BookTimePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const limit = await checkIpRateLimit("book-page", 120, 60_000);
  const found = limit.allowed ? await publicBookingPage(slug) : null;
  if (limit.allowed && !found) notFound();

  const services = found ? found.services.filter(canBookTime) : [];
  if (found && (found.page.time_booking === "off" || services.length === 0)) redirect(`/book/${found.page.slug}`);
  // How long the crew is there: a job two people share takes half the time.
  const shares = found ? await orgDividesCrewHours(found.page.organization_id) : false;

  return (
    <div className="flex min-h-[100dvh] justify-center bg-muted/30 px-4 py-8">
      <main className="h-fit w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {!found ? (
          <>
            <h1 className="text-2xl font-bold">One moment</h1>
            <p className="mt-2 text-base text-muted-foreground">That&rsquo;s a lot of visits to this page. Wait a minute and try again.</p>
          </>
        ) : (
          <>
            <header className="flex items-center gap-3">
              {found.company.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, from its own storage
                <img src={found.company.logo_url} alt="" className="h-12 w-auto max-w-[10rem] object-contain" />
              ) : null}
              <p className="text-lg font-semibold">{found.company.name}</p>
            </header>
            <h1 className="mb-5 mt-6 text-3xl font-bold tracking-tight">Book a clean</h1>
            <TimePicker
              slug={found.page.slug}
              companyName={found.company.name}
              phone={found.company.contact_phone}
              held={found.page.time_booking === "approve"}
              services={services.map((s) => ({
                id: s.id,
                name: s.name,
                length: `About ${formatDurationMinutes(onSiteMinutes(s.default_duration_minutes ?? 0, s.online_crew_size, shares))}`,
                price: publicPrice(s.booking_page_price, s.default_price_cents, (cents) => formatCurrencyCents(cents, found.company.currency as "CAD" | "USD")),
              }))}
              button={brandButtonColors(found.company.brand_color)}
              turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
              preview={found.preview}
            />
            <p className="mt-8 border-t border-border pt-5 text-base">
              <Link href={`/book/${found.page.slug}`} className="font-medium underline underline-offset-4">
                Back to {found.company.name}
              </Link>
              {found.company.contact_phone && (
                <>
                  {" "}
                  · Rather talk to someone? Call{" "}
                  <a href={`tel:${found.company.contact_phone.replace(/[^\d+]/g, "")}`} className="font-semibold underline underline-offset-4">
                    {found.company.contact_phone}
                  </a>
                </>
              )}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
