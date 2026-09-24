import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { PageShell } from "@/components/page-shell";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AnnounceForm } from "./announce-form";

export const metadata = { title: "Announce" };

export default async function AnnouncePage() {
  const membership = await requireMembership();
  if (!["owner", "admin", "manager"].includes(membership.role)) {
    redirect("/app");
  }

  // Both counts are shown on the form so the sender knows what "everyone"
  // means before they send, and can see for themselves why the email box
  // matters: push reaches devices, not people.
  const admin = createSupabaseAdminClient();
  const [{ count: teamSize }, { count: pushDevices }] = await Promise.all([
    admin
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id)
      .eq("status", "active"),
    admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", membership.organization_id),
  ]);

  return (
    <PageShell
      title="Announce"
      description="One message to the whole team — in chat, in their notifications, and optionally by email."
    >
      <div className="max-w-2xl">
        <AnnounceForm
          teamSize={teamSize ?? 0}
          pushDevices={pushDevices ?? 0}
        />
      </div>
    </PageShell>
  );
}
