import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubscriptionInfo } from "@/lib/subscription";
import { isStripeEnabled } from "@/lib/stripe";
import { TrialEndedWall } from "@/components/trial-ended-wall";
import { AppSidebar } from "@/components/app-sidebar";
import { AdminTabBar } from "@/components/admin-tab-bar";
import { DesktopToolRibbon } from "@/components/desktop-tool-ribbon";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { TrialBanner } from "@/components/trial-banner";
import { AutomationsOffBanner } from "@/components/automations-off-banner";
import { SetupReturnBanner } from "@/components/setup-return-banner";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { QuickActions } from "@/components/quick-actions";
import { AIWidget } from "@/components/ai-assistant/ai-widget";
import { getOrgTimezone } from "@/lib/org-timezone";
import { zonedDayBoundsUtc } from "@/lib/wall-clock";
import { isFeedVisible } from "@/lib/feed-visibility";

/** Shape of app_shell_counts(). Every field optional — a failed RPC degrades
 *  to an unbadged shell rather than an error page. */
type ShellCounts = {
  profile_full_name?: string | null;
  org_onboarding_completed_at?: string | null;
  org_logo_url?: string | null;
  org_brand_color?: string | null;
  org_name?: string | null;
  unread_notifications?: number;
  today_bookings?: number;
  overdue_invoices?: number;
  pending_estimates?: number;
  unread_chat?: number;
  new_reviews?: number;
  pending_requests?: number;
  open_job_requests?: number;
  overdue_tasks?: number;
  new_applicants?: number;
  new_leads?: number;
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Employees belong in /field. Owners, admins, and managers get /app.
  // requireMembership with an allow-list redirects employees → /field automatically.
  const membership = await requireMembership(["owner", "admin", "manager"]);

  const supabase = await createSupabaseServerClient();
  // Independent org-scoped lookups — one round-trip instead of three
  // sequential ones. This layout is the front door of every /app render;
  // waterfalls here tax every single page.
  const [subscriptionInfo, orgTz, feedEnabled] = await Promise.all([
    getSubscriptionInfo(membership.organization_id),
    getOrgTimezone(membership.organization_id),
    isFeedVisible(membership.organization_id),
  ]);

  // Hard wall: an expired org (trial elapsed, or past-due grace run out) gets
  // the subscribe screen INSTEAD of the app — the single chokepoint every
  // /app route passes through. Only enforced when Stripe billing is actually
  // live, so a non-Stripe environment can never accidentally lock everyone
  // out. Overridden (free_forever/comp) and legacy orgs never reach here.
  if (isStripeEnabled() && subscriptionInfo.gate === "expired") {
    return (
      <TrialEndedWall
        info={subscriptionInfo}
        role={membership.role}
        orgName={membership.organization_name}
      />
    );
  }

  // Today's boundaries in the ORG'S timezone. The comment here always said
  // that; the code used FALLBACK_TZ — fine for one Edmonton tenant, wrong for
  // every org that signs up anywhere else, whose "today's jobs" badge would
  // tick over at another country's midnight.
  const dayBounds = zonedDayBoundsUtc(new Date(), orgTz, 0);
  const todayStart = dayBounds.start;
  const todayEnd = new Date(dayBounds.end.getTime() - 1);

  // ONE round trip for the whole shell. This block used to await thirteen
  // separate PostgREST calls — the profile, the org, and eleven nav badges —
  // in parallel, so every navigation in /app paid the cost of the slowest of
  // them before the page it was opening had fetched anything. Measured at
  // ~840ms. The counts are microseconds of work sitting behind hundreds of
  // milliseconds of network, so they moved next to the data.
  //
  // See supabase/migrations/20260903020000_app_shell_counts.sql. It runs
  // SECURITY INVOKER, so every count is still bound by the caller's own RLS.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const { data: shell } = (await supabase.rpc("app_shell_counts" as never, {
    p_org: membership.organization_id,
    p_membership: membership.id,
    p_today_start: todayStart.toISOString(),
    p_today_end: todayEnd.toISOString(),
    p_reviews_since: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString(),
  } as never)) as unknown as { data: ShellCounts | null };

  // A failed RPC must not blank the shell: fall back to zeroes, which render
  // as "no badges" rather than an error page over a nav decoration.
  const counts: ShellCounts = shell ?? {};
  const profile = { full_name: counts.profile_full_name ?? null };
  const org = {
    onboarding_completed_at: counts.org_onboarding_completed_at ?? null,
    logo_url: counts.org_logo_url ?? null,
    brand_color: counts.org_brand_color ?? null,
    name: counts.org_name ?? null,
  };
  const unreadNotifications = counts.unread_notifications ?? 0;
  const todayBookings = counts.today_bookings ?? 0;
  const overdueInvoices = counts.overdue_invoices ?? 0;
  const pendingEstimates = counts.pending_estimates ?? 0;
  const unreadChat = counts.unread_chat ?? 0;
  const newReviews = counts.new_reviews ?? 0;
  const pendingRequests = counts.pending_requests ?? 0;
  const openJobRequests = counts.open_job_requests ?? 0;
  const overdueTasks = counts.overdue_tasks ?? 0;
  const newApplicants = counts.new_applicants ?? 0;
  const newLeads = counts.new_leads ?? 0;

  const showSetup =
    !org?.onboarding_completed_at &&
    (membership.role === "owner" || membership.role === "admin");

  // Per-org feature gate — feed defaults to OFF. Sidebar uses this
  // to hide the Feed link entirely; the page itself also checks and
  // 404s if a bookmarked URL is hit.

  return (
    <BrandProvider
      brandColor={org?.brand_color ?? null}
      className="flex min-h-[100dvh] lg:h-screen"
    >
      <AppSidebar
        organizationName={membership.organization_name}
        role={membership.role}
        capabilities={membership.capabilities}
        userName={profile?.full_name ?? null}
        showSetup={showSetup}
        logoUrl={org?.logo_url ?? null}
        brandColor={org?.brand_color ?? null}
        unreadNotifications={unreadNotifications ?? 0}
        feedEnabled={feedEnabled}
        tabBadges={{
          "/app/bookings": todayBookings ?? 0,
          "/app/bookings/requests":
            (pendingRequests ?? 0) + (openJobRequests ?? 0),
          "/app/invoices": overdueInvoices ?? 0,
          "/app/estimates": pendingEstimates ?? 0,
          "/app/chat": Number(unreadChat ?? 0),
          "/app/reviews": newReviews ?? 0,
          "/app/tasks": overdueTasks ?? 0,
          "/app/applicants": newApplicants ?? 0,
          "/app/leads": newLeads ?? 0,
        }}
      />
      {/* pt-14 for the fixed mobile top bar; bottom padding = tab bar height
          plus the safe-area inset the bar itself grows by on gesture-nav
          phones. Both zero out at lg where the sidebar takes over. */}
      {/* overflow-x-hidden is load-bearing, not decoration. `overflow-y-auto`
          alone computes overflow-x to `auto` per spec, so this column — the
          real scrolling element, not body — could drift sideways whenever any
          child ran a few pixels wide, and the app felt loose in the hand
          instead of rigid. The overscroll rules in globals.css sit on
          html/body and never applied here. Wide content is unaffected: every
          table and board carries its own overflow-x-auto scroller, which is
          where sideways movement belongs. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-x-none pb-[calc(4rem+env(safe-area-inset-bottom))] pt-14 lg:pb-0 lg:pt-0">
        <DesktopToolRibbon />
        <TrialBanner info={subscriptionInfo} role={membership.role} />
        <AutomationsOffBanner
          organizationId={membership.organization_id}
          role={membership.role}
        />
        <SetupReturnBanner />
        <PushPrompt
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
        {/* Install prompt for admins on phones. The banner already self-hides
            when installed or dismissed; lg:hidden keeps desktops on the
            quieter Settings card instead. Mounting it here also registers
            the service worker for admin sessions — previously only field
            visits did that. */}
        {/* empty:hidden — the banner renders null for most sessions
            (dismissed, already installed); without it the wrapper's mt-3
            leaves 12px of phantom space on every mobile page. */}
        <div className="mt-3 empty:hidden lg:hidden">
          <PwaInstallBanner />
        </div>
        {children}
        {/* Tab bar mounts BEFORE the palette/widget so their z-50 overlays
            paint above the sheet when both are open (last-in-DOM wins at
            equal z). */}
        <AdminTabBar
          role={membership.role}
          capabilities={membership.capabilities}
          unreadNotifications={unreadNotifications ?? 0}
          feedEnabled={feedEnabled}
          tabBadges={{
            "/app/bookings": todayBookings ?? 0,
            "/app/bookings/requests":
              (pendingRequests ?? 0) + (openJobRequests ?? 0),
            "/app/invoices": overdueInvoices ?? 0,
            "/app/estimates": pendingEstimates ?? 0,
            "/app/chat": Number(unreadChat ?? 0),
            "/app/reviews": newReviews ?? 0,
            "/app/tasks": overdueTasks ?? 0,
            "/app/applicants": newApplicants ?? 0,
            "/app/leads": newLeads ?? 0,
          }}
        />
        <QuickActions
          role={membership.role}
          capabilities={membership.capabilities}
          hasAssistant
        />
        <AIWidget />
      </div>
    </BrandProvider>
  );
}
