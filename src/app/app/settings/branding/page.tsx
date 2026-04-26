import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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
    .select("id, name, logo_url, brand_color, google_review_url")
    .eq("id", membership.organization_id)
    .maybeSingle() as unknown as {
    data: {
      id: string;
      name: string;
      logo_url: string | null;
      brand_color: string | null;
      google_review_url: string | null;
    } | null;
  };

  return (
    <PageShell
      title="Branding"
      description="Customize your logo and brand colour. These appear on invoices, public links, and your dashboard."
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
      <BrandingForm
        organizationId={membership.organization_id}
        currentLogoUrl={org?.logo_url ?? null}
        currentBrandColor={org?.brand_color ?? null}
        currentGoogleReviewUrl={org?.google_review_url ?? null}
        orgName={org?.name ?? ""}
      />
    </PageShell>
  );
}
