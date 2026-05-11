import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldShell } from "@/components/field-shell";
import { BrandProvider } from "@/components/brand-provider";
import { PushPrompt } from "@/components/push-prompt";
import { GpsConsentBanner } from "@/components/gps-consent-banner";

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Field app is open to every active member, including owners/admins so
  // they can dogfood it. RLS still scopes data to their org.
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const [{ data: profile }, { data: org }, { data: consentRow }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", membership.profile_id)
        .maybeSingle(),
      supabase
        .from("organizations")
        .select("logo_url, brand_color")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: { logo_url: string | null; brand_color: string | null } | null;
      },
      // Check whether this member has acknowledged the GPS consent notice.
      (supabase
        .from("memberships")
        .select("gps_consent_accepted_at")
        .eq("id", membership.id)
        .maybeSingle()) as unknown as {
        data: { gps_consent_accepted_at: string | null } | null;
      },
    ]);

  const needsGpsConsent = !consentRow?.gps_consent_accepted_at;

  return (
    <BrandProvider brandColor={org?.brand_color ?? null}>
      <FieldShell
        organizationName={membership.organization_name}
        userName={profile?.full_name ?? null}
        logoUrl={org?.logo_url ?? null}
        brandColor={org?.brand_color ?? null}
        role={membership.role}
      >
        <PushPrompt
          membershipId={membership.id}
          organizationId={membership.organization_id}
        />
        <GpsConsentBanner needsConsent={needsGpsConsent} />
        {children}
      </FieldShell>
    </BrandProvider>
  );
}
