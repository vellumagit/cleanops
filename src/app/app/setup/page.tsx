import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { SetupChecklist } from "./setup-checklist";

export const metadata = { title: "Get started" };

export default async function SetupPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  // If onboarding is already done, redirect to dashboard
  const { data: org } = await supabase
    .from("organizations")
    .select("onboarding_completed_at")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as { data: { onboarding_completed_at: string | null } | null };

  if (org?.onboarding_completed_at) {
    redirect("/app");
  }

  // Check completion state for each step
  const [clients, bookings, members, orgSettings, invoices] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", membership.organization_id),
      supabase
        .from("organizations")
        .select("default_payment_instructions, logo_url, brand_color")
        .eq("id", membership.organization_id)
        .maybeSingle() as unknown as {
        data: {
          default_payment_instructions: string | null;
          logo_url: string | null;
          brand_color: string | null;
        } | null;
      },
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true }),
    ]);

  // Also check pending invitations
  const { count: inviteCount } = await supabase
    .from("invitations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id);

  const steps = {
    hasClient: (clients.count ?? 0) > 0,
    hasBooking: (bookings.count ?? 0) > 0,
    hasTeam: (members.count ?? 0) > 1 || (inviteCount ?? 0) > 0,
    hasBranding: !!(orgSettings.data?.logo_url || orgSettings.data?.brand_color),
    hasPaymentInstructions: !!orgSettings.data?.default_payment_instructions,
    hasInvoice: (invoices.count ?? 0) > 0,
  };

  return (
    <PageShell
      title="Get started"
      description={`Set up ${membership.organization_name} in a few quick steps.`}
    >
      <SetupChecklist steps={steps} orgName={membership.organization_name} />
    </PageShell>
  );
}
