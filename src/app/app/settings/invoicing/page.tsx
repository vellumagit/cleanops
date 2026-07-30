import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { InvoicingForm } from "./invoicing-form";

export const metadata = { title: "Invoicing" };

/**
 * Always re-read on load. These settings are edited and immediately
 * re-checked by the same person, so serving a cached render is exactly the
 * wrong tradeoff — a stale checkbox reads as "my save was ignored".
 */
export const dynamic = "force-dynamic";

export default async function InvoicingSettingsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("organizations")
    .select(
      "invoice_auto_send_enabled, invoice_auto_send_hour, invoice_auto_send_consolidated",
    )
    .eq("id", membership.organization_id)
    .maybeSingle();

  const org = data as {
    invoice_auto_send_enabled: boolean;
    invoice_auto_send_hour: number | null;
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
          this on to also send them at a set time the next day — with a hold /
          send-now escape hatch on every draft, and an optional morning digest
          so you can review before anything goes out.
        </p>
        {/* Keyed on the SAVED values so the form remounts whenever they
            change. The inputs are controlled from useState, which seeds only
            on mount — without this, a form re-rendered after a save could
            keep showing pre-save values, which reads as "my change didn't
            stick" even though the database took it. */}
        <InvoicingForm
          key={`${Boolean(org?.invoice_auto_send_enabled)}-${org?.invoice_auto_send_hour ?? 17}-${org?.invoice_auto_send_consolidated ?? true}`}
          enabled={Boolean(org?.invoice_auto_send_enabled)}
          sendHour={org?.invoice_auto_send_hour ?? 17}
          consolidated={org?.invoice_auto_send_consolidated ?? true}
        />
      </section>
    </PageShell>
  );
}
