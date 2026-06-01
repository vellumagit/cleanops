import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { SecurityPanel } from "@/app/app/profile/security/security-panel";

export const metadata = { title: "Security" };

/**
 * Per-employee security settings — the field-app entry point for
 * managing personal MFA. Mirrors /app/profile/security so owners +
 * employees both have somewhere to enable two-factor authentication.
 *
 * Before this route existed, employees had no way to opt into MFA
 * from inside their app — the /app/* security page bounces them
 * back to /field. Now they can self-serve from /field/profile.
 *
 * MFA stays opt-in and OFF by default — same policy as the admin
 * console. The login flow's MFA gate auto-detects enrollment, so an
 * employee who flips MFA on here will be challenged on their next
 * sign-in without any extra config.
 */
export default async function FieldSecurityPage() {
  await requireMembership(); // any role — employees included
  const supabase = await createSupabaseServerClient();

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactors = (factorsData?.totp ?? []).map((f) => ({
    id: f.id,
    status: f.status,
    friendlyName: f.friendly_name ?? "Authenticator app",
    createdAt: f.created_at ?? null,
  }));

  return (
    <>
      <FieldHeader
        title="Security"
        description="Add a second factor to your sign-in for stronger account protection."
        actions={
          <Link
            href="/field/profile"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Profile
          </Link>
        }
      />
      <SecurityPanel factors={totpFactors} />
    </>
  );
}
