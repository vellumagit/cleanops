import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPriceMode, nameProblem, type PriceMode } from "@/lib/booking-page-rules";

/**
 * A company's booking page, read for the two people who see it: the office
 * setting it up (Settings, Online booking) and whoever opens the link.
 *
 * The public never reads the table themselves. This module reads it with
 * the admin client and decides what a visitor may see: a published page is
 * for anyone; a draft is for that company's own office, which is how
 * "preview before anyone sees it" works.
 */
type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type BookingPage = {
  organization_id: string;
  slug: string;
  status: "draft" | "published";
  headline: string | null;
  intro: string | null;
  published_at: string | null;
  /** Whether a visitor can pick a time, and whether the office confirms it. */
  time_booking: "off" | "approve" | "instant";
};

export type PageService = {
  id: string;
  name: string;
  description: string | null;
  default_price_cents: number | null;
  /** The booked length: the hours for one person. Null when none is set. */
  default_duration_minutes: number | null;
  /** How many cleaners the job needs when booked online. */
  online_crew_size: number;
  show_on_booking_page: boolean;
  booking_page_price: PriceMode;
};

const PAGE_COLUMNS = "organization_id, slug, status, headline, intro, published_at, time_booking";

/** A service a visitor can pick a time for: on the page, with a length. */
export const canBookTime = (s: PageService) => s.show_on_booking_page && (s.default_duration_minutes ?? 0) > 0;

/** This company's page, or null when it hasn't made one. */
export async function bookingPageFor(organizationId: string, admin: Admin = createSupabaseAdminClient()): Promise<BookingPage | null> {
  const { data, error } = (await admin
    .from("booking_pages" as never)
    .select(PAGE_COLUMNS)
    .eq("organization_id" as never, organizationId as never)
    .maybeSingle()) as unknown as { data: BookingPage | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  return data;
}

/** The company's active services, with what each shows on the page. */
export async function pageServices(organizationId: string, admin: Admin = createSupabaseAdminClient()): Promise<PageService[]> {
  const { data, error } = (await admin
    .from("service_types")
    .select("id, name, description, default_price_cents, default_duration_minutes, online_crew_size, show_on_booking_page, booking_page_price, sort_order" as never)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })) as unknown as {
    data: Array<Omit<PageService, "booking_page_price"> & { booking_page_price: string }> | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    ...s,
    show_on_booking_page: s.show_on_booking_page === true,
    online_crew_size: Math.min(6, Math.max(1, Number(s.online_crew_size) || 1)),
    booking_page_price: isPriceMode(s.booking_page_price) ? s.booking_page_price : "hidden",
  }));
}

export type PublicBookingPage = {
  page: BookingPage;
  company: { name: string; logo_url: string | null; brand_color: string | null; contact_phone: string | null; currency: string };
  services: PageService[];
  /** True when this is a draft shown to the company's own office. */
  preview: boolean;
};

/**
 * What the link opens, or null (which the page turns into "not found").
 *
 * - A name that isn't one, or that nobody has claimed: null.
 * - A published page: for anyone.
 * - A draft: only for someone signed in as an owner, admin or manager of
 *   that company. To everyone else a draft does not exist.
 */
export async function publicBookingPage(slugRaw: string): Promise<PublicBookingPage | null> {
  const slug = (slugRaw ?? "").toLowerCase();
  // The same rule the name was claimed under; anything else can't match.
  if (nameProblem(slug)) return null;

  const admin = createSupabaseAdminClient();
  const { data: page, error } = (await admin
    .from("booking_pages" as never)
    .select(PAGE_COLUMNS)
    .eq("slug" as never, slug as never)
    .maybeSingle()) as unknown as { data: BookingPage | null; error: { message: string } | null };
  if (error) throw new Error(error.message);
  if (!page) return null;

  let preview = false;
  if (page.status !== "published") {
    if (!(await isOfficeOf(page.organization_id))) return null;
    preview = true;
  }

  const { data: org } = (await admin
    .from("organizations")
    .select("name, logo_url, brand_color, contact_phone, currency_code" as never)
    .eq("id", page.organization_id)
    .maybeSingle()) as unknown as {
    data: { name: string; logo_url: string | null; brand_color: string | null; contact_phone: string | null; currency_code: string | null } | null;
  };
  if (!org) return null;

  const services = (await pageServices(page.organization_id, admin)).filter((s) => s.show_on_booking_page);
  return {
    page,
    company: {
      name: org.name,
      logo_url: org.logo_url,
      brand_color: org.brand_color,
      contact_phone: org.contact_phone?.trim() || null,
      currency: org.currency_code === "USD" ? "USD" : "CAD",
    },
    services,
    preview,
  };
}

/** Is whoever is making this request signed in as this company's office? */
async function isOfficeOf(organizationId: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) return false;
    const { data } = (await createSupabaseAdminClient()
      .from("memberships")
      .select("id")
      .eq("profile_id", userId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "manager"])
      .limit(1)) as unknown as { data: Array<{ id: string }> | null };
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Whether a signed-in client of this company can book a time themselves,
 * and with what: the page must be published, picking a time switched on,
 * and at least one service on the page with a length. The same three
 * things the public page asks. Null when any is missing, and when the
 * page can't be read (then the client area offers the request form, as it
 * always did).
 */
export async function clientBookingOffer(
  organizationId: string,
  admin: Admin = createSupabaseAdminClient(),
): Promise<{ page: BookingPage; services: PageService[] } | null> {
  try {
    const [page, services] = await Promise.all([bookingPageFor(organizationId, admin), pageServices(organizationId, admin)]);
    if (!page || page.status !== "published" || page.time_booking === "off") return null;
    const bookable = services.filter(canBookTime);
    return bookable.length > 0 ? { page, services: bookable } : null;
  } catch (err) {
    console.error("[booking-page] could not read whether clients can book:", err);
    return null;
  }
}
