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
    .select("id, type, title, body, href, read_at, created_at, recipient_membership_id")
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
      recipient_membership_id: string | null;
    }> | null;
  };

  // A team notice is read for THIS person when they have a row in
  // notification_reads (see notifications/actions.ts). Its own read_at only
  // counts for ones marked read before reads were kept per person.
  const teamIds = (notifications ?? [])
    .filter((n) => n.recipient_membership_id === null && !n.read_at)
    .map((n) => n.id);
  const myReads = new Map<string, string>();
  if (teamIds.length > 0) {
    const { data: reads } = (await supabase
      .from("notification_reads" as never)
      .select("notification_id, read_at")
      .eq("membership_id", membership.id)
      .in("notification_id", teamIds)) as unknown as {
      data: Array<{ notification_id: string; read_at: string }> | null;
    };
    for (const r of reads ?? []) myReads.set(r.notification_id, r.read_at);
  }
  const shown = (notifications ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    created_at: n.created_at,
    read_at: n.read_at ?? myReads.get(n.id) ?? null,
  }));

  const canManage = membership.role === "owner" || membership.role === "admin";
  // The office chooses what alerts each of them; cleaners don't.
  const isOffice = canManage || membership.role === "manager";

  return (
    <PageShell
      title="Notifications"
      description="Stay on top of reviews, inventory, and scheduling alerts."
      actions={
        canManage ? (
          <Link
            href="/app/settings/team-alerts"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Manage alerts
          </Link>
        ) : undefined
      }
    >
      {isOffice && (
        <p className="mb-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          Getting too many of these on your phone?{" "}
          <Link
            href="/app/notifications/choices"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Choose what alerts you
          </Link>
          . Those are your own choices.
          {canManage && (
            <>
              {" "}
              What the company sends at all is in{" "}
              <Link
                href="/app/settings/team-alerts"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Settings → Team alerts & housekeeping
              </Link>
              .
            </>
          )}
        </p>
      )}
      <NotificationList notifications={shown} />
    </PageShell>
  );
}
