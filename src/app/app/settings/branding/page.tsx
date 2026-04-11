import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { BrandingForm } from "./branding-form";

export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, logo_url, brand_color")
    .eq("id", membership.organization_id)
    .single() as unknown as {
    data: {
      id: string;
      name: string;
      logo_url: string | null;
      brand_color: string | null;
    } | null;
  };

  return (
    <PageShell
      title="Branding"
      description="Customize your logo and brand colour. These appear on invoices, public links, and your dashboard."
    >
      <BrandingForm
        organizationId={membership.organization_id}
        currentLogoUrl={org?.logo_url ?? null}
        currentBrandColor={org?.brand_color ?? null}
        orgName={org?.name ?? ""}
      />
    </PageShell>
  );
}
