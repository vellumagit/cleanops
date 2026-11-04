import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { isTwilioEnabled } from "@/lib/twilio";
import { getOrgSmsUsage } from "@/lib/sms";
import { canCreateData } from "@/lib/subscription";
import { SmsSettingsForm } from "./sms-settings-form";
import { UsRegistration } from "./us-registration";
import {
  EMPTY_INPUT,
  smsCountryFor,
  type RegistrationInput,
  type RegistrationStatus,
} from "@/lib/sms-registration-rules";
import { hostedPolicyUrls } from "@/lib/twilio-a2p";

export const metadata = { title: "SMS / Texting" };

export default async function SmsSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const orgId = membership.organization_id;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select(
      "sms_enabled, sms_from_number, sms_number_sid, sms_overage_cap_cents, holiday_region, timezone, name, contact_email, contact_phone",
    )
    .eq("id", orgId)
    .maybeSingle();

  const org = data as {
    sms_enabled: boolean;
    sms_from_number: string | null;
    sms_number_sid: string | null;
    sms_overage_cap_cents: number;
    holiday_region: string | null;
    timezone: string | null;
    name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  } | null;

  const [usage, canEnable] = await Promise.all([
    getOrgSmsUsage(orgId),
    canCreateData(orgId),
  ]);

  // A US business registers with the carriers first (twilio-a2p.ts); the
  // usual controls appear once that's approved.
  const isUs = org ? smsCountryFor(org) === "US" : false;
  type RegistrationRow = {
    status: RegistrationStatus;
    status_detail: string | null;
    details: Record<string, string>;
    submitted_at: string | null;
    last_checked_at: string | null;
  };
  const registration: RegistrationRow | null = isUs
    ? (
        (await admin
          .from("sms_registrations" as never)
          .select("status, status_detail, details, submitted_at, last_checked_at")
          .eq("organization_id" as never, orgId as never)
          .maybeSingle()) as unknown as { data: RegistrationRow | null }
      ).data
    : null;
  const showRegistration = isUs && registration?.status !== "approved";
  const saved = registration?.details ?? {};
  // Never the EIN itself: only its last four, to say one is on file.
  const values: RegistrationInput = {
    ...EMPTY_INPUT,
    brand_name: org?.name ?? "",
    support_email: org?.contact_email ?? "",
    support_phone: org?.contact_phone ?? "",
    ...(Object.fromEntries(
      Object.entries(saved).filter(([k]) => k in EMPTY_INPUT && k !== "ein"),
    ) as Partial<RegistrationInput>),
    ein: "",
  };
  const hosted = hostedPolicyUrls(orgId);

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
      {showRegistration ? (
        <UsRegistration
          status={registration?.status ?? null}
          statusDetail={registration?.status_detail ?? null}
          values={values}
          einLast4={saved.ein_last4 || null}
          hostedPrivacyUrl={hosted.privacyUrl}
          hostedTermsUrl={hosted.termsUrl}
          submittedAt={registration?.submitted_at ?? null}
          lastCheckedAt={registration?.last_checked_at ?? null}
          timeZone={org?.timezone ?? "America/Edmonton"}
        />
      ) : (
      <SmsSettingsForm
        enabled={Boolean(org?.sms_enabled)}
        number={org?.sms_from_number ?? null}
        simulated={org?.sms_number_sid === "SIMULATED"}
        twilioLive={isTwilioEnabled()}
        capDollars={Math.round((org?.sms_overage_cap_cents ?? 5000) / 100)}
        canEnable={canEnable}
        usage={usage}
      />
      )}
    </PageShell>
  );
}
