import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

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
        .select("onboarding_completed_at, logo_url, brand_color")
        .eq("id", membership.organization_id)
        .single() as unknown as {
        data: {
          onboarding_completed_at: string | null;
          logo_url: string | null;
          brand_color: string | null;
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
    <div className="flex h-screen">
      <AppSidebar
        organizationName={membership.organization_name}
        role={membership.role}
        userName={profile?.full_name ?? null}
        showSetup={showSetup}
        logoUrl={org?.logo_url ?? null}
        brandColor={org?.brand_color ?? null}
        unreadNotifications={unreadNotifications ?? 0}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
