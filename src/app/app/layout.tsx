import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandProvider } from "@/components/brand-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await requireMembership();

  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: org }, { count: unreadNotifications }] =
    await Promise.all([
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
      />
      {/* pt-14 on mobile for the fixed top bar, lg:pt-0 when sidebar is visible */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pt-14 lg:pt-0">
        {children}
      </div>
    </BrandProvider>
  );
}
