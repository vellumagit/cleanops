import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { bookingPageFor, pageServices, type BookingPage, type PageService } from "@/lib/booking-page";
import { nameProblem, tidyName } from "@/lib/booking-page-rules";
import { DEFAULT_RULES, readRules } from "@/lib/open-time-rules";
import type { OpenTimeRules } from "@/lib/open-times";
import { memberDisplayName } from "@/lib/member-display";
import { formatCurrencyCents, formatDurationMinutes } from "@/lib/format";
import { getOrgCurrency } from "@/lib/org-currency";
import { OnlineBookingForm } from "./online-booking-form";
import { OpenTimesForm } from "./open-times-form";
import { OpenTimesPreview } from "./open-times-preview";
import { WebsiteSnippets } from "./website-snippets";
import { brandButtonColors } from "@/lib/readable-on";
import { bookingButtonHtml, bookingEmbedHtml } from "@/lib/website-embed";

export const metadata = { title: "Online booking" };

/**
 * Settings, Online booking. A company has no booking page until it makes
 * one here: claim the name, build it as a draft, preview it, publish it
 * (docs/online-booking-roadmap.md, "Nothing is created automatically").
 *
 * Below the page itself: when the company can be booked and by whom, and an
 * office-only preview of the open times that produces (roadmap phase 2).
 */
export default async function OnlineBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; from?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin"]);
  const orgId = membership.organization_id;
  const { service: previewService, from: previewFrom } = await searchParams;
  const admin = createSupabaseAdminClient();

  // Read on their own, so the page still opens (as "not set up") on a
  // database that doesn't have the table yet.
  let page: BookingPage | null = null;
  let services: PageService[] = [];
  let ready = true;
  try {
    [page, services] = await Promise.all([bookingPageFor(orgId, admin), pageServices(orgId, admin)]);
  } catch (err) {
    console.error("[online-booking] could not read the page:", err);
    ready = false;
  }

  // The open-time rules and who takes online bookings. Their own read: a
  // database without those columns yet shows the page without this part.
  let rules: OpenTimeRules | null = null;
  let timeBooking: "off" | "approve" | "instant" = "off";
  let changeNoticeHours = 48;
  let people: Array<{ id: string; name: string; role: string; takes: boolean }> = [];
  if (page) {
    try {
      const [rulesRes, peopleRes] = await Promise.all([
        admin
          .from("booking_pages" as never)
          .select("opening_hours, min_notice_hours, max_days_ahead, gap_minutes, slot_step_minutes, time_booking, change_notice_hours")
          .eq("organization_id" as never, orgId as never)
          .maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>,
        admin
          .from("memberships")
          .select("id, role, display_name, takes_online_bookings, profile:profiles ( full_name )" as never)
          .eq("organization_id", orgId)
          .eq("status", "active") as unknown as Promise<{
          data: Array<{ id: string; role: string; display_name: string | null; takes_online_bookings: boolean | null; profile: { full_name: string | null } | null }> | null;
          error: { message: string } | null;
        }>,
      ]);
      if (rulesRes.error) throw new Error(rulesRes.error.message);
      if (peopleRes.error) throw new Error(peopleRes.error.message);
      rules = rulesRes.data ? readRules(rulesRes.data) : DEFAULT_RULES;
      const mode = rulesRes.data?.time_booking;
      timeBooking = mode === "approve" || mode === "instant" ? mode : "off";
      const notice = Number(rulesRes.data?.change_notice_hours);
      if (Number.isFinite(notice) && notice >= 0) changeNoticeHours = notice;
      people = (peopleRes.data ?? [])
        .map((m) => ({ id: m.id, name: memberDisplayName(m), role: m.role, takes: m.takes_online_bookings === true }))
        // Cleaners first, then the office: the people most likely to be ticked.
        .sort((a, b) => Number(a.role !== "employee") - Number(b.role !== "employee") || a.name.localeCompare(b.name));
    } catch (err) {
      console.error("[online-booking] could not read the open-time rules:", err);
      rules = null;
    }
  }

  const [currency, orgRow] = await Promise.all([
    getOrgCurrency(orgId),
    admin.from("organizations").select("slug, name, brand_color").eq("id", orgId).maybeSingle() as unknown as Promise<{
      data: { slug: string | null; name: string | null; brand_color: string | null } | null;
    }>,
  ]);
  // A starting suggestion only: the company's name, tidied. Theirs to change.
  const fromName = tidyName(orgRow.data?.name ?? "");
  const suggestion = !nameProblem(fromName) ? fromName : "";
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://sollos3.com").replace(/\/$/, "");

  const brandButton = brandButtonColors(orgRow.data?.brand_color ?? null);

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
        <div className="space-y-5">
          <OnlineBookingForm
            site={site}
            page={page}
            suggestion={suggestion}
            services={services.map((s) => ({
              id: s.id,
              name: s.name,
              price: s.default_price_cents != null && s.default_price_cents > 0 ? formatCurrencyCents(s.default_price_cents, currency) : null,
              length: s.default_duration_minutes != null && s.default_duration_minutes > 0 ? formatDurationMinutes(s.default_duration_minutes) : null,
              crewSize: s.online_crew_size,
              show: s.show_on_booking_page,
              priceMode: s.booking_page_price,
            }))}
          />
          {page && (
            <div className="max-w-2xl">
              <WebsiteSnippets
                live={page.status === "published"}
                buttonHtml={bookingButtonHtml(site, page.slug, brandButton)}
                embedHtml={bookingEmbedHtml(site, page.slug)}
                button={brandButton}
              />
            </div>
          )}
          {page && rules && (
            <div className="max-w-2xl space-y-5">
              <OpenTimesForm rules={rules} people={people} timeBooking={timeBooking} changeNoticeHours={changeNoticeHours} />
              <OpenTimesPreview
                organizationId={orgId}
                services={services.map((s) => ({ id: s.id, name: s.name, minutes: s.default_duration_minutes }))}
                serviceId={previewService ?? null}
                fromYmd={previewFrom && /^\d{4}-\d{2}-\d{2}$/.test(previewFrom) ? previewFrom : null}
              />
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
