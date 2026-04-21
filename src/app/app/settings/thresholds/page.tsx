import Link from "next/link";
import { ArrowLeft, Sliders } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { ThresholdsForm } from "./form";

export const metadata = { title: "Automation thresholds" };

export default async function ThresholdsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data } = (await admin
    .from("organizations")
    .select(
      `stale_estimate_expire_days,
       invoice_void_days,
       booking_auto_complete_hours,
       archive_after_days,
       overtime_threshold_hours`,
    )
    .eq("id", membership.organization_id)
    .maybeSingle()) as unknown as {
    data: {
      stale_estimate_expire_days: number | null;
      invoice_void_days: number | null;
      booking_auto_complete_hours: number | null;
      archive_after_days: number | null;
      overtime_threshold_hours: number | null;
    } | null;
  };

  return (
    <PageShell
      title="Automation thresholds"
      description="Tune the timing on system-level automations. Blank a field to disable that automation for your organization."
      actions={
        <Link
          href="/app/settings"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
        <Sliders className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-muted-foreground">
          These values drive the nightly hygiene crons. Most organizations can
          leave them at their defaults. Leave a field blank to disable its
          matching automation for your org specifically — the other orgs on
          Sollos are unaffected.
        </p>
      </div>
      <ThresholdsForm
        defaults={{
          stale_estimate_expire_days: data?.stale_estimate_expire_days ?? null,
          invoice_void_days: data?.invoice_void_days ?? null,
          booking_auto_complete_hours: data?.booking_auto_complete_hours ?? null,
          archive_after_days: data?.archive_after_days ?? null,
          overtime_threshold_hours: data?.overtime_threshold_hours ?? 40,
        }}
      />
    </PageShell>
  );
}
