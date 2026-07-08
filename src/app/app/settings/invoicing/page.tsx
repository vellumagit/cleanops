import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { InvoicingForm } from "./invoicing-form";

export const metadata = { title: "Invoicing" };

export default async function InvoicingSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select(
      "invoice_auto_send_enabled, invoice_auto_send_delay_hours, invoice_auto_send_consolidated",
    )
    .eq("id", membership.organization_id)
    .maybeSingle();

  const org = data as {
    invoice_auto_send_enabled: boolean;
    invoice_auto_send_delay_hours: number;
    invoice_auto_send_consolidated: boolean;
  } | null;

  return (
    <PageShell
      title="Invoicing"
      description="Automatic invoice sending and review window."
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
      <section>
        <h2 className="text-sm font-semibold">Auto-send</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          Invoices are always drafted automatically when a job completes. Turn
          this on to also send them automatically after a review window — with a
          hold / send-now escape hatch on every draft.
        </p>
        <InvoicingForm
          enabled={Boolean(org?.invoice_auto_send_enabled)}
          delayHours={org?.invoice_auto_send_delay_hours ?? 24}
          consolidated={org?.invoice_auto_send_consolidated ?? true}
        />
      </section>
    </PageShell>
  );
}
