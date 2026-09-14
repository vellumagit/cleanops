"use client";

import { usePathname } from "next/navigation";
import { GoogleAnalytics } from "@next/third-parties/google";

/**
 * Google Analytics, marketing pages ONLY.
 *
 * The questions this answers — which page converts, where visitors come
 * from — are about the public site. The product must stay out of it: a
 * customer's bookings, invoices and payroll pages have no business in a
 * third party's logs, and the Privacy Policy promises exactly that split
 * (section 1, "Usage and diagnostic data"). If this list changes, that
 * paragraph changes with it.
 */
const GA_ID = "G-CWKMZFWZRB";
const PUBLIC_PATHS = ["/", "/pricing", "/security", "/privacy", "/terms", "/signup"];

export function PublicAnalytics() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
  if (!isPublic) return null;
  return <GoogleAnalytics gaId={GA_ID} />;
}
