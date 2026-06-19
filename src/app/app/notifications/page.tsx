import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
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
    .or(
      `recipient_membership_id.is.null,recipient_membership_id.eq.${membership.id}`,
    )
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

  const canManage = membership.role === "owner" || membership.role === "admin";

  return (
    <PageShell
      title="Notifications"
      description="Stay on top of reviews, inventory, and scheduling alerts."
      actions={
        canManage ? (
          <Link
            href="/app/settings/automations"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Manage alerts
          </Link>
        ) : undefined
      }
    >
      {canManage && (
        <p className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          Getting too many of these? Choose exactly which alerts and digests you
          receive in{" "}
          <Link
            href="/app/settings/automations"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Settings → Automations
          </Link>
          .
        </p>
      )}
      <NotificationList notifications={notifications ?? []} />
    </PageShell>
  );
}
