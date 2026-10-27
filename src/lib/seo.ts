/**
 * Structured data (schema.org JSON-LD) for the public marketing surface.
 *
 * One home for the facts search engines and AI answer engines read about
 * Sollos itself — name, logo, what it is, what it costs — so the homepage,
 * pricing and help pages can't describe three slightly different products.
 * Rendered through <JsonLd> (src/components/json-ld.tsx).
 *
 * Only state what is true on the page a crawler lands on. No ratings or
 * reviews until real ones exist: Google treats invented ones as spam, and
 * the placeholder testimonials were pulled for the same reason.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

const ORG_ID = `${SITE_URL}/#organization`;
const APP_ID = `${SITE_URL}/#software`;

/**
 * The currency the $49 / $99 list prices are charged in — USD, confirmed by
 * the owner (the marketing pages print a bare "$"). Subscriptions only: what
 * an org charges its own clients follows its currency_code, CAD or USD. If
 * the subscription prices ever move to another currency, change this with
 * them — an Offer with the wrong currency is worse than no Offer, and null
 * drops the Offers entirely.
 */
const PLAN_CURRENCY: "CAD" | "USD" | null = "USD";

const PLANS = [
  { name: "Starter", price: "49", description: "For solo owners and small crews. Up to 5 employees." },
  { name: "Growth", price: "99", description: "For established cleaning operations. Up to 25 employees." },
];

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Sollos 3",
    url: SITE_URL,
    logo: `${SITE_URL}/sollos-logo.png`,
    email: "hello@sollos3.com",
    // The market: cleaning companies on both sides of the border.
    areaServed: [
      { "@type": "Country", name: "Canada" },
      { "@type": "Country", name: "United States" },
    ],
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: "Sollos 3",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Field service management software for cleaning companies",
    operatingSystem: "Web, iOS, Android",
    description:
      "Operations software for cleaning companies: bookings and scheduling, crew management, invoicing and online payments, timesheets and payroll, team chat, and a mobile field app for cleaners.",
    publisher: { "@id": ORG_ID },
    ...(PLAN_CURRENCY
      ? {
          offers: PLANS.map((p) => ({
            "@type": "Offer",
            name: p.name,
            description: p.description,
            price: p.price,
            priceCurrency: PLAN_CURRENCY,
            url: `${SITE_URL}/pricing`,
            category: "subscription",
          })),
        }
      : {}),
  };
}

export function faqPageJsonLd(faqs: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** `items` are [name, path] pairs from the root down, e.g. Help → Bookings. */
export function breadcrumbJsonLd(items: ReadonlyArray<[name: string, path: string]>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}${path}`,
    })),
  };
}
