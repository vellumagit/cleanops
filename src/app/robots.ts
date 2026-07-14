import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com";

/**
 * robots.txt — allow crawling of the public marketing site, disallow the
 * authenticated app surfaces and every per-recipient token route (invoices,
 * contracts, estimates, review/unsubscribe links, pay pages). Those are
 * private, single-use URLs that should never be indexed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/app/",
          "/field/",
          "/client/",
          "/i/",
          "/c/",
          "/e/",
          "/r/",
          "/u/",
          "/pay/",
          "/claim/",
          "/join/",
          "/review/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
