import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { SenderEmailForm } from "./sender-email-form";

export const metadata = { title: "Email settings" };

export default async function EmailSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select("sender_email, sender_email_verified_at")
    .eq("id", membership.organization_id)
    .maybeSingle();

  const org = data as {
    sender_email: string | null;
    sender_email_verified_at: string | null;
  } | null;

  return (
    <PageShell
      title="Email settings"
      description="Configure the sender address for invoices, confirmations, and other notifications."
      actions={
        <Link
          href="/app/settings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Settings
        </Link>
      }
    >
      <SenderEmailForm
        currentEmail={org?.sender_email ?? null}
        isVerified={Boolean(org?.sender_email_verified_at)}
      />
    </PageShell>
  );
}
