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

  const [
    { data: profile },
    { data: org },
    { count: unreadNotifications },
    { count: todayBookings },
    { count: overdueInvoices },
    { count: pendingEstimates },
    { data: unreadChat },
    { count: newReviews },
    { count: pendingRequests },
    { count: openJobRequests },
    { count: overdueTasks },
    { count: newApplicants },
    { count: newLeads },
  ] = await (async () => {
    // Capture once — used as the lower bound on two time-windowed counts.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const reviewsSince = new Date(
      nowMs - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    return Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("onboarding_completed_at, logo_url, brand_color, name")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: {
          onboarding_completed_at: string | null;
          logo_url: string | null;
          brand_color: string | null;
          name: string | null;
        } | null;
      },
      supabase
        .from("notifications" as never)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .or(
          `recipient_membership_id.is.null,recipient_membership_id.eq.${membership.id}`,
        )
        .is("read_at", null) as unknown as { count: number | null },
      // Today's bookings
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_at", todayStart.toISOString())
        .lte("scheduled_at", todayEnd.toISOString()),
      // Overdue invoices
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("status", "overdue"),
      // Pending estimates (sent, awaiting response)
      supabase
        .from("estimates")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent"),
      // Unread chat — real per-member unread count (messages after each
      // thread's last_read_at watermark that the member didn't send).
      supabase.rpc(
        "chat_unread_total" as never,
        {
          p_org_id: membership.organization_id,
        } as never,
      ) as unknown as {
        data: number | null;
      },
      // New reviews in the last 7 days
      supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .gte("submitted_at", reviewsSince),
      // Pending booking requests from the client portal
      supabase
        .from("booking_requests" as never)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .eq("status", "pending") as unknown as { count: number | null },
      // Open skips + inquiries (client_job_requests) — the badge counted
      // only portal booking requests, so website inquiries arrived to a
      // nav item that looked quiet. The counter is the clear picture.
      supabase
        .from("client_job_requests" as never)
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, membership.organization_id as never)
        .eq("status" as never, "open" as never) as unknown as {
        count: number | null;
      },
      // Overdue + today tasks (incomplete, due <= now)
      supabase
        .from("tasks" as never)
        .select("id", { count: "exact", head: true })
        .lte("due_at" as never, todayEnd.toISOString())
        .is("completed_at" as never, null) as unknown as {
        count: number | null;
      },
      // New job applicants awaiting review
      supabase
        .from("job_applicants" as never)
        .select("id", { count: "exact", head: true })
        .eq("organization_id" as never, membership.organization_id as never)
        .eq("status" as never, "new" as never) as unknown as {
        count: number | null;
      },
      // Leads nobody has replied to yet. Counted at stage 'new' rather than all
      // open leads: a badge that shows every lead in the pipeline never clears,
      // and a number that never changes stops being read.
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id)
        .eq("lifecycle" as never, "lead" as never)
        .eq("lead_stage" as never, "new" as never)
        .is("archived_at" as never, null as never) as unknown as {
        count: number | null;
      },
    ]);
  })();

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
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] pt-14 lg:pb-0 lg:pt-0">
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
