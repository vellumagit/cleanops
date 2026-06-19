import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubscriptionInfo } from "@/lib/subscription";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { TrialBanner } from "@/components/trial-banner";
import { SetupReturnBanner } from "@/components/setup-return-banner";
import { QuickActions } from "@/components/quick-actions";
import { AIWidget } from "@/components/ai-assistant/ai-widget";
import { DEFAULT_TZ } from "@/lib/format";
import { isFeedVisible } from "@/lib/feed-visibility";

// Orgs with the AI assistant enabled — must match the allow-list in /api/ai-chat
const AI_ENABLED_ORGS = new Set([
  "4cf4c402-5889-43c9-91f3-7186f66ee08b", // Svit Company Inc
]);

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Employees belong in /field. Owners, admins, and managers get /app.
  // requireMembership with an allow-list redirects employees → /field automatically.
  const membership = await requireMembership(["owner", "admin", "manager"]);

  const supabase = await createSupabaseServerClient();
  const subscriptionInfo = await getSubscriptionInfo(membership.organization_id);

  // Compute today's boundaries in the org's timezone
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TZ,
  }).format(now);
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  const utcRepr = new Date(
    utcMidnight.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  const tzRepr = new Date(
    utcMidnight.toLocaleString("en-US", { timeZone: DEFAULT_TZ }),
  );
  const offsetMs = utcRepr.getTime() - tzRepr.getTime();
  const todayStart = new Date(utcMidnight.getTime() + offsetMs);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

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
    { count: overdueTasks },
    { count: newApplicants },
  ] = await (async () => {
    // Capture once — used as the lower bound on two time-windowed counts.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const reviewsSince = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
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
    (supabase
      .from("notifications" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id)
      .or(
        `recipient_membership_id.is.null,recipient_membership_id.eq.${membership.id}`,
      )
      .is("read_at", null)) as unknown as { count: number | null },
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
    supabase.rpc("chat_unread_total" as never, {
      p_org_id: membership.organization_id,
    } as never) as unknown as {
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
    // Overdue + today tasks (incomplete, due <= now)
    supabase
      .from("tasks" as never)
      .select("id", { count: "exact", head: true })
      .lte("due_at" as never, todayEnd.toISOString())
      .is("completed_at" as never, null) as unknown as { count: number | null },
    // New job applicants awaiting review
    supabase
      .from("job_applicants" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id" as never, membership.organization_id as never)
      .eq("status" as never, "new" as never) as unknown as { count: number | null },
  ]);
  })();

  const showSetup =
    !org?.onboarding_completed_at &&
    (membership.role === "owner" || membership.role === "admin");

  // Per-org feature gate — feed defaults to OFF. Sidebar uses this
  // to hide the Feed link entirely; the page itself also checks and
  // 404s if a bookmarked URL is hit.
  const feedEnabled = await isFeedVisible(membership.organization_id);

  return (
    <BrandProvider brandColor={org?.brand_color ?? null} className="flex min-h-[100dvh] lg:h-screen">
      <AppSidebar
        organizationName={membership.organization_name}
        role={membership.role}
        userName={profile?.full_name ?? null}
        showSetup={showSetup}
        logoUrl={org?.logo_url ?? null}
        brandColor={org?.brand_color ?? null}
        unreadNotifications={unreadNotifications ?? 0}
        feedEnabled={feedEnabled}
        tabBadges={{
          "/app/bookings": todayBookings ?? 0,
          "/app/bookings/requests": pendingRequests ?? 0,
          "/app/invoices": overdueInvoices ?? 0,
          "/app/estimates": pendingEstimates ?? 0,
          "/app/chat": Number(unreadChat ?? 0),
          "/app/reviews": newReviews ?? 0,
          "/app/tasks": overdueTasks ?? 0,
          "/app/applicants": newApplicants ?? 0,
        }}
      />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 when sidebar is visible */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pt-14 lg:pt-0">
        <TrialBanner info={subscriptionInfo} role={membership.role} />
        <SetupReturnBanner />
        <PushPrompt
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
        {children}
        <QuickActions
          role={membership.role}
          hasAssistant={AI_ENABLED_ORGS.has(membership.organization_id)}
        />
        {AI_ENABLED_ORGS.has(membership.organization_id) && <AIWidget />}
      </div>
    </BrandProvider>
  );
}
