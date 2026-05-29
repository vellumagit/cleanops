import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { SecurityPanel } from "./security-panel";

export const metadata = { title: "Security" };

/**
 * Per-user security settings — currently surfaces multi-factor auth
 * enrollment. MFA is OPTIONAL and OFF BY DEFAULT. Users opt in here
 * by scanning a TOTP QR code with an authenticator app.
 *
 * Owners and admins can enable MFA on their own accounts to harden the
 * highest-privilege roles against credential stuffing. Future enterprise-
 * tier work may flip a per-org "Require MFA for admins" switch on top of
 * this — for now, voluntary.
 */
export default async function SecurityPage() {
  await requireMembership(); // any role can manage their own MFA
  const supabase = await createSupabaseServerClient();

  // List currently-enrolled MFA factors. An empty list = no MFA on the
  // account. Up to one verified TOTP factor is expected; we still
  // render the list so users can see and remove obsolete factors.
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactors = (factorsData?.totp ?? []).map((f) => ({
    id: f.id,
    status: f.status,
    friendlyName: f.friendly_name ?? "Authenticator app",
    createdAt: f.created_at ?? null,
  }));

  return (
    <PageShell
      title="Security"
      description="Add a second factor to your sign-in for stronger account protection."
    >
      <SecurityPanel factors={totpFactors} />
    </PageShell>
  );
}
