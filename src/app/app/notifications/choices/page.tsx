import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { readMutedTopics } from "@/lib/notification-topics";
import { NotificationChoicesForm } from "./choices-form";

export const metadata = { title: "What alerts you" };

/**
 * Each office person's own choice of which notices buzz their phone and
 * reach their email (lib/notification-topics.ts). Cleaners have no such
 * page: what they are sent, they need.
 */
export default async function NotificationChoicesPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);

  // The caller's own row. Read with the admin client so the page still
  // opens, showing "everything", on a database without the column yet.
  let muted: ReturnType<typeof readMutedTopics> = new Set();
  try {
    const { data } = (await createSupabaseAdminClient()
      .from("memberships")
      .select("notification_prefs" as never)
      .eq("id", membership.id)
      .eq("organization_id", membership.organization_id)
      .maybeSingle()) as unknown as { data: { notification_prefs: unknown } | null };
    muted = readMutedTopics(data?.notification_prefs);
  } catch (err) {
    console.error("[notifications] could not read notice choices:", err);
  }

  return (
    <PageShell
      title="What alerts you"
      description="Choose which notices buzz your phone and reach your email. These are your own choices; nobody else's change."
      actions={
        <Link
          href="/app/notifications"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Notifications
        </Link>
      }
    >
      <NotificationChoicesForm muted={[...muted]} />
      <div className="mt-6 max-w-2xl space-y-2 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">A quiet topic is never lost.</span> It still appears
          under the bell in the app, marked unread until you open it.
        </p>
        <p>
          <span className="font-medium text-foreground">Some notices always alert you,</span> because something
          is stopped until a person acts: texting paused at its monthly limit, the calendar disconnected, an
          invoice that could not be sent. So does anything sent to you by name, such as a task assigned to you.
        </p>
      </div>
    </PageShell>
  );
}
