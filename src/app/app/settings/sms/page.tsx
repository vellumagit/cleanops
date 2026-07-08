import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { isTwilioEnabled } from "@/lib/twilio";
import { getOrgSmsUsage } from "@/lib/sms";
import { canCreateData } from "@/lib/subscription";
import { SmsSettingsForm } from "./sms-settings-form";

export const metadata = { title: "SMS / Texting" };

export default async function SmsSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const orgId = membership.organization_id;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select("sms_enabled, sms_from_number, sms_number_sid, sms_overage_cap_cents")
    .eq("id", orgId)
    .maybeSingle();

  const org = data as {
    sms_enabled: boolean;
    sms_from_number: string | null;
    sms_number_sid: string | null;
    sms_overage_cap_cents: number;
  } | null;

  const [usage, canEnable] = await Promise.all([
    getOrgSmsUsage(orgId),
    canCreateData(orgId),
  ]);

  return (
    <PageShell
      title="SMS / Texting"
      description="Text booking confirmations and reminders to clients from your own number."
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
      <SmsSettingsForm
        enabled={Boolean(org?.sms_enabled)}
        number={org?.sms_from_number ?? null}
        simulated={org?.sms_number_sid === "SIMULATED"}
        twilioLive={isTwilioEnabled()}
        capDollars={Math.round((org?.sms_overage_cap_cents ?? 5000) / 100)}
        canEnable={canEnable}
        usage={usage}
      />
    </PageShell>
  );
}
