import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { NotificationList } from "./notification-list";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const { data: notifications } = (await supabase
    .from("notifications" as never)
    .select("id, type, title, body, href, read_at, created_at")
    .eq("organization_id", membership.organization_id)
    .order("created_at", { ascending: false })
    .limit(100)) as unknown as {
    data: Array<{
      id: string;
      type: string;
      title: string;
      body: string | null;
      href: string | null;
      read_at: string | null;
      created_at: string;
    }> | null;
  };

  return (
    <PageShell
      title="Notifications"
      description="Stay on top of reviews, inventory, and scheduling alerts."
    >
      <NotificationList notifications={notifications ?? []} />
    </PageShell>
  );
}
