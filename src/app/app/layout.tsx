import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const membership = await requireMembership();

  // Pull the user's display name for the sidebar footer
  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", membership.profile_id)
    .maybeSingle();

  return (
    <div className="flex h-screen">
      <AppSidebar
        organizationName={membership.organization_name}
        role={membership.role}
        userName={profile?.full_name ?? null}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
