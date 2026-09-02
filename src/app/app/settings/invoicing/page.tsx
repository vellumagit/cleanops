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
import { TippingForm } from "./tipping-form";
import { parseTippingSettings } from "@/lib/tip-split";

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

  // Two queries, deliberately. tipping_settings is a newer column, and
  // PostgREST fails the WHOLE select if any one column is unknown — folding it
  // into the query above would mean a schema-cache hiccup renders auto-send as
  // OFF with no error shown, which is precisely the "my setting didn't save"
  // report this file already carries scar tissue for.
  const [{ data }, { data: tipData }] = await Promise.all([
    admin
      .from("organizations")
      .select(
        "invoice_auto_send_enabled, invoice_auto_send_hour, invoice_auto_send_consolidated, invoice_auto_send_mode, invoice_auto_send_delay_hours, invoice_auto_send_weekday",
      )
      .eq("id", membership.organization_id)
      .maybeSingle(),
    (async () => {
      try {
        return (await admin
          .from("organizations")
          .select("tipping_settings, stripe_account_id, stripe_charges_enabled")
          .eq("id", membership.organization_id)
          .maybeSingle()) as unknown as {
          data: {
            tipping_settings: unknown;
            stripe_account_id: string | null;
            stripe_charges_enabled: boolean | null;
          } | null;
        };
      } catch {
        // Tipping section degrades to "off"; auto-send above is untouched.
        return { data: null };
      }
    })(),
  ]);

  const org = data as {
    invoice_auto_send_enabled: boolean;
    invoice_auto_send_hour: number | null;
    invoice_auto_send_consolidated: boolean;
    invoice_auto_send_mode: string | null;
    invoice_auto_send_delay_hours: number | null;
    invoice_auto_send_weekday: number | null;
  } | null;

  const tipping = parseTippingSettings(tipData?.tipping_settings);

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

      <section className="mt-10 border-t border-border pt-8">
        <h2 className="text-sm font-semibold">Tips</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          Stripe has no tipping for invoice links &mdash; its built-in tipping
          is for in-person card readers &mdash; so this is ours. When it&rsquo;s
          on, clients paying by card can add a tip, and we record who it&rsquo;s
          owed to so you can pay it out. Off by default.
        </p>
        <TippingForm
          enabled={tipping.enabled}
          presets={tipping.presets}
          stripeConnected={Boolean(
            tipData?.stripe_account_id && tipData?.stripe_charges_enabled,
          )}
        />
      </section>

      <section className="mt-10 border-t border-border pt-8">
        <SatelliteAutomations
          title="Invoicing automations"
          items={INVOICING_AUTOMATIONS}
        />
      </section>
    </PageShell>
  );
}
