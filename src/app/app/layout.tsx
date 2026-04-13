import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { DEFAULT_TZ } from "@/lib/format";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await requireMembership();

  const supabase = await createSupabaseServerClient();

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
    { count: unreadChat },
    { count: newReviews },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", membership.profile_id)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("onboarding_completed_at, logo_url, brand_color, name")
      .eq("id", membership.organization_id)
      .single() as unknown as {
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
    // Unread chat — threads with messages newer than last read (simplified:
    // count threads updated in the last 24h as a proxy)
    supabase
      .from("chat_messages" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .neq("sender_id", membership.id) as unknown as {
      count: number | null;
    },
    // New reviews in the last 7 days
    supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .gte(
        "submitted_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      ),
  ]);

  const showSetup =
    !org?.onboarding_completed_at &&
    (membership.role === "owner" || membership.role === "admin");

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
        tabBadges={{
          "/app/bookings": todayBookings ?? 0,
          "/app/invoices": overdueInvoices ?? 0,
          "/app/estimates": pendingEstimates ?? 0,
          "/app/chat": unreadChat ?? 0,
          "/app/reviews": newReviews ?? 0,
        }}
      />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 when sidebar is visible */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pt-14 lg:pt-0">
        <PushPrompt
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
        {children}
      </div>
    </BrandProvider>
  );
}
