import Link from "next/link";
import { ArrowLeft, CheckCircle2, CalendarDays, Plug, XCircle } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  isQuickBooksConfigured,
  isStripeConnectConfigured,
  isSquareConfigured,
  isGoogleCalendarConfigured,
} from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
} from "./google-calendar-actions";

export const metadata = { title: "Integrations" };

type ProviderKey = "stripe" | "square" | "quickbooks" | "google_calendar";

type ProviderCard = {
  key: ProviderKey;
  name: string;
  blurb: string;
  platformReady: boolean;
  accentClass: string;
  category: "payments" | "productivity";
};

/**
 * Integrations page — Phase 12 Part 1 + Google Calendar.
 *
 * Shows payment processor cards and productivity integrations.
 * Each card has three possible states:
 *
 *   1. "Coming soon" — no platform env vars
 *   2. "Not connected" — env vars exist but no active connection
 *   3. "Connected" — active row in integration_connections
 */
export default async function IntegrationsPage() {
  const membership = await requireMembership(["owner", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase
    .from("integration_connections")
    .select("provider, status, external_account_id, connected_at, updated_at")
    .eq("organization_id", membership.organization_id);

  const byProvider = new Map<
    ProviderKey,
    {
      status: string;
      external_account_id: string | null;
      connected_at: string;
      updated_at: string;
    }
  >();
  for (const r of rows ?? []) {
    byProvider.set(r.provider as ProviderKey, r);
  }

  const paymentCards: ProviderCard[] = [
    {
      key: "stripe",
      name: "Stripe",
      blurb:
        "Accept cards, Apple Pay, Google Pay, ACH. Funds land in your bank in 2 business days.",
      platformReady: isStripeConnectConfigured(),
      accentClass: "from-violet-500/10 to-indigo-500/10",
      category: "payments",
    },
    {
      key: "square",
      name: "Square",
      blurb:
        "Accept cards with next-day deposits. Best if you already use Square in-person.",
      platformReady: isSquareConfigured(),
      accentClass: "from-teal-500/10 to-emerald-500/10",
      category: "payments",
    },
    {
      key: "quickbooks",
      name: "QuickBooks Online",
      blurb:
        "Sync invoices + customers into QuickBooks so your bookkeeper isn't doing double entry.",
      platformReady: isQuickBooksConfigured(),
      accentClass: "from-lime-500/10 to-green-500/10",
      category: "payments",
    },
  ];

  const productivityCards: ProviderCard[] = [
    {
      key: "google_calendar",
      name: "Google Calendar",
      blurb:
        "Automatically sync bookings to Google Calendar. Create, update, and delete events as you manage jobs.",
      platformReady: isGoogleCalendarConfigured(),
      accentClass: "from-blue-500/10 to-sky-500/10",
      category: "productivity",
    },
  ];

  function renderCard(card: ProviderCard) {
    const conn = byProvider.get(card.key);
    const isConnected = conn?.status === "active";
    const isGcal = card.key === "google_calendar";

    return (
      <li
        key={card.key}
        className="relative overflow-hidden rounded-lg border border-border bg-card p-5"
      >
        <div
          className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-br ${card.accentClass}`}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold tracking-tight">
              {isGcal && (
                <CalendarDays className="mr-1.5 -mt-0.5 inline-block h-4 w-4 text-blue-500" />
              )}
              {card.name}
            </h3>
            {isConnected ? (
              <StatusBadge tone="green">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Connected
              </StatusBadge>
            ) : card.platformReady ? (
              <StatusBadge tone="neutral">Not connected</StatusBadge>
            ) : (
              <StatusBadge tone="amber">Coming soon</StatusBadge>
            )}
          </div>

          <p className="mt-2 min-h-[3.5rem] text-xs text-muted-foreground">
            {card.blurb}
          </p>

          <div className="mt-4 border-t border-border pt-4">
            {isConnected ? (
              <>
                <dl className="space-y-1 text-[11px]">
                  {conn?.external_account_id && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Account</dt>
                      <dd className="font-mono text-foreground">
                        {conn.external_account_id.length > 24
                          ? conn.external_account_id.slice(0, 24) + "…"
                          : conn.external_account_id}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Since</dt>
                    <dd className="text-foreground">
                      {formatDateTime(conn!.connected_at)}
                    </dd>
                  </div>
                </dl>
                {isGcal ? (
                  <form action={disconnectGoogleCalendarAction}>
                    <button
                      type="submit"
                      className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground"
                  >
                    <XCircle className="h-3 w-3" />
                    Disconnect
                  </button>
                )}
              </>
            ) : card.platformReady ? (
              isGcal ? (
                <form action={connectGoogleCalendarAction}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:bg-foreground/90 transition-colors"
                  >
                    Connect Google Calendar
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full items-center justify-center rounded-md border border-dashed border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground"
                  title="OAuth handoff wiring in progress"
                >
                  Connect {card.name} — wiring up
                </button>
              )
            ) : (
              <p className="text-[11px] italic text-muted-foreground">
                We&apos;re finishing the{" "}
                {card.name === "QuickBooks Online"
                  ? "Intuit"
                  : card.name}{" "}
                app registration. This will light up automatically
                once it&apos;s approved.
              </p>
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <PageShell
      title="Integrations"
      description="Connect external services to streamline your workflow."
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
      <div className="space-y-8">
        {/* Payment processors */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Payment Processors</h2>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground mb-4">
            <p>
              <span className="font-medium text-foreground">
                Sollos never holds your money.
              </span>{" "}
              When a client pays an invoice, the money moves directly from them
              to the processor account you connect here.
            </p>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {paymentCards.map(renderCard)}
          </ul>
        </div>

        {/* Productivity */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Productivity</h2>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {productivityCards.map(renderCard)}
          </ul>
        </div>
      </div>
    </PageShell>
  );
}
