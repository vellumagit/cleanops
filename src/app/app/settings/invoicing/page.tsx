import { SatelliteAutomations } from "@/app/app/settings/automations/satellite-automations";
import type { SendMode } from "@/lib/invoice-send-schedule";
import { getOrgTimezone } from "@/lib/org-timezone";
import { INVOICING_AUTOMATIONS } from "@/app/app/settings/automations/satellite-registry";
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
  // The org's zone, so "going out Friday at 5:00 PM" means the org's Friday
  // and the org's five — not the viewer's laptop.
  const tz = await getOrgTimezone(membership.organization_id);

  // Card tips used to be configured here too; they moved to Settings →
  // Getting paid on 2026-11-21, beside the tip wording that shares their
  // column.
  const { data } = await admin
    .from("organizations")
    .select(
      "invoice_auto_send_enabled, invoice_auto_send_hour, invoice_auto_send_consolidated, invoice_auto_send_mode, invoice_auto_send_delay_hours, invoice_auto_send_weekday",
    )
    .eq("id", membership.organization_id)
    .maybeSingle();

  const org = data as {
    invoice_auto_send_enabled: boolean;
    invoice_auto_send_hour: number | null;
    invoice_auto_send_consolidated: boolean;
    invoice_auto_send_mode: string | null;
    invoice_auto_send_delay_hours: number | null;
    invoice_auto_send_weekday: number | null;
  } | null;

  return (
    <PageShell
      title="Invoicing"
      description="When invoices are drafted and sent, the morning review, and auto-void."
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
          Sends drafted invoices for you at a set time — with a hold /
          send-now escape hatch on every draft, and an optional morning digest
          so you can review before anything goes out. Drafting itself is the{" "}
          <strong>Auto-draft invoice on job complete</strong> switch below;
          without it, auto-send only sends drafts you make yourself.
        </p>
        <InvoicingForm
          enabled={Boolean(org?.invoice_auto_send_enabled)}
          sendHour={org?.invoice_auto_send_hour ?? 17}
          consolidated={org?.invoice_auto_send_consolidated ?? true}
          sendMode={
            (org?.invoice_auto_send_mode as SendMode | null) ?? "next_day"
          }
          delayHours={org?.invoice_auto_send_delay_hours ?? 24}
          weekday={org?.invoice_auto_send_weekday ?? 5}
          timezone={tz}
        />
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        Looking for card tips? They&apos;re on{" "}
        <Link href="/app/settings/payment-methods" className="underline underline-offset-2">
          Getting paid
        </Link>
        , with the tip wording clients see on the invoice.
      </p>

      <section className="mt-10 border-t border-border pt-8">
        <SatelliteAutomations
          title="Invoicing automations"
          items={INVOICING_AUTOMATIONS}
        />
      </section>
    </PageShell>
  );
}
