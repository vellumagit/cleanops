import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { canBookTime, publicBookingPage } from "@/lib/booking-page";
import { publicPrice } from "@/lib/booking-page-rules";
import { formatCurrencyCents } from "@/lib/format";
import { brandButtonColors } from "@/lib/readable-on";
import { AskForm } from "./ask-form";
import { EmbedBridge } from "./embed-bridge";

export const dynamic = "force-dynamic";

/**
 * A cleaning company's own page: sollos3.com/book/<name>.
 *
 * It is the company's, not Sollos's: their logo, colour and words. Two
 * things to do, each one big button: ask for a clean, or see your cleans.
 * Built to the client screens' rules (docs/online-booking-roadmap.md).
 *
 * A name nobody has claimed, and a draft opened by anyone but that
 * company's office, are both "not found": a draft does not exist to the
 * public.
 */
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const embed = (await searchParams).embed === "1";
  const found = await publicBookingPage(slug).catch(() => null);
  if (!found) return { title: "Page not found", robots: { index: false, follow: false } };
  return {
    title: found.page.headline ? `${found.company.name}: ${found.page.headline}` : found.company.name,
    description: found.page.intro?.slice(0, 160) ?? `Ask ${found.company.name} for a clean, or see your visits and invoices.`,
    // A draft is nobody's business but the office's; the copy inside a
    // company's website is the same page, indexed once, at its own address.
    robots: found.preview || embed ? { index: false, follow: false } : undefined,
  };
}

/**
 * `?embed=1`: the same page inside the company's own website
 * (public/embed/book.js). No full-screen background, the frame is told the
 * page's height, and anything that leaves the booking page opens in a new
 * tab: signing in can't happen inside someone else's website.
 */
export default async function BookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const embed = (await searchParams).embed === "1";

  const limit = await checkIpRateLimit("book-page", 120, 60_000);
  if (!limit.allowed) {
    return (
      <Frame embed={embed}>
        <h1 className="text-2xl font-bold">One moment</h1>
        <p className="mt-2 text-base text-muted-foreground">That&rsquo;s a lot of visits to this page. Wait a minute and try again.</p>
      </Frame>
    );
  }

  const found = await publicBookingPage(slug);
  if (!found) notFound();
  const { page, company, services, preview } = found;
  const button = brandButtonColors(company.brand_color);
  const money = (cents: number) => formatCurrencyCents(cents, company.currency as "CAD" | "USD");
  // "Book a clean" is there only when the company switched it on and has
  // something on the page with a length to book.
  const canBook = page.time_booking !== "off" && services.some(canBookTime);

  return (
    <Frame embed={embed}>
      {preview && (
        <p role="status" data-testid="preview-banner" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">Preview.</span> Only you and your office can see this. It isn&rsquo;t published
          yet.
        </p>
      )}

      <header className="flex items-center gap-3">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, from its own storage
          <img src={company.logo_url} alt="" className="h-12 w-auto max-w-[10rem] object-contain" />
        ) : null}
        <p className="text-lg font-semibold">{company.name}</p>
      </header>

      <h1 className="mt-6 text-balance text-3xl font-bold tracking-tight">{page.headline || company.name}</h1>
      {page.intro && <p className="mt-3 whitespace-pre-line text-base text-muted-foreground">{page.intro}</p>}

      {canBook && (
        <Link
          href={`/book/${page.slug}/time${embed ? "?embed=1" : ""}`}
          style={{ ...button, borderWidth: 1, borderStyle: "solid" }}
          className="mt-6 flex min-h-14 items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90"
        >
          Book a clean
        </Link>
      )}
      <div className={`${canBook ? "mt-3" : "mt-6"} grid gap-3 sm:grid-cols-2`}>
        <a
          href="#ask"
          style={canBook ? undefined : { ...button, borderWidth: 1, borderStyle: "solid" }}
          className={
            canBook
              ? "flex min-h-14 items-center justify-center rounded-xl border border-border bg-card px-5 text-lg font-semibold transition-colors hover:bg-muted"
              : "flex min-h-14 items-center justify-center rounded-xl px-5 text-lg font-semibold transition-opacity hover:opacity-90"
          }
        >
          Ask for a clean
        </a>
        <Link
          href="/client/login"
          {...(embed ? { target: "_blank", rel: "noopener" } : {})}
          className="flex min-h-14 items-center justify-center rounded-xl border border-border bg-card px-5 text-lg font-semibold transition-colors hover:bg-muted"
        >
          See my cleans
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Already a client? &ldquo;See my cleans&rdquo; shows your visits and invoices.</p>

      {services.length > 0 && (
        <section className="mt-8" aria-labelledby="what-we-do">
          <h2 id="what-we-do" className="text-xl font-semibold">
            What we do
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {services.map((s) => {
              const price = publicPrice(s.booking_page_price, s.default_price_cents, money);
              return (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium [overflow-wrap:anywhere]">{s.name}</p>
                    {s.description && <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>}
                  </div>
                  {price && <p className="shrink-0 text-base font-semibold tabular-nums">{price}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="ask" className="mt-8 scroll-mt-6" aria-labelledby="ask-heading">
        <h2 id="ask-heading" className="text-xl font-semibold">
          Ask for a clean
        </h2>
        <p className="mb-4 mt-1 text-base text-muted-foreground">
          {canBook
            ? "Not sure what you need, or want something that isn't listed? Tell us, and we'll get back to you with a time and a price."
            : "Tell us what you need. We'll get back to you with a time and a price."}
        </p>
        <AskForm
          slug={page.slug}
          companyName={company.name}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          button={button}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
          disabledReason={preview ? "This is a preview, so the form is switched off. Publish your page and it will take requests." : null}
        />
      </section>

      {company.contact_phone && (
        <p className="mt-8 border-t border-border pt-5 text-base">
          Rather talk to someone? Call {company.name} at{" "}
          <a href={`tel:${company.contact_phone.replace(/[^\d+]/g, "")}`} className="font-semibold underline underline-offset-4">
            {company.contact_phone}
          </a>
          .
        </p>
      )}
    </Frame>
  );
}

function Frame({ children, embed = false }: { children: React.ReactNode; embed?: boolean }) {
  if (embed) {
    return (
      <div data-embed-root className="flex justify-center p-1">
        <EmbedBridge />
        <main className="h-fit w-full max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-8">{children}</main>
      </div>
    );
  }
  return (
    <div className="flex min-h-[100dvh] justify-center bg-muted/30 px-4 py-8">
      <main className="h-fit w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</main>
    </div>
  );
}
