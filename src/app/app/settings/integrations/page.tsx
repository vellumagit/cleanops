import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, CalendarDays, Plug, XCircle, AlertTriangle } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  isQuickBooksConfigured,
  isStripeConnectConfigured,
  isSquareConfigured,
  isGoogleCalendarConfigured,
  isSageConfigured,
} from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
} from "./google-calendar-actions";
import {
  connectSageAction,
  disconnectSageAction,
} from "./sage-actions";
import { StripeDisconnectButton } from "./stripe-connect-actions";

export const metadata = { title: "Integrations" };

type ProviderKey = "stripe" | "square" | "quickbooks" | "google_calendar" | "sage";

type ProviderCard = {
  key: ProviderKey;
  name: string;
  blurb: string;
  platformReady: boolean;
  accentClass: string;
  category: "payments" | "productivity" | "accounting";
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

  // Stripe Connect status lives on the organizations row (not
  // integration_connections) because we only store the account id + cached
  // capabilities — no OAuth tokens.
  const admin = createSupabaseAdminClient();
  const { data: orgStripe } = await admin
    .from("organizations")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_connected_at",
    )
    .eq("id", membership.organization_id)
    .maybeSingle();
  const stripeInfo = orgStripe as {
    stripe_account_id: string | null;
    stripe_charges_enabled: boolean;
    stripe_payouts_enabled: boolean;
    stripe_details_submitted: boolean;
    stripe_connected_at: string | null;
  } | null;

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
  ];

  const accountingCards: ProviderCard[] = [
    {
      key: "quickbooks",
      name: "QuickBooks Online",
      blurb:
        "Sync invoices + customers into QuickBooks so your bookkeeper isn't doing double entry.",
      platformReady: isQuickBooksConfigured(),
      accentClass: "from-lime-500/10 to-green-500/10",
      category: "accounting",
    },
    {
      key: "sage",
      name: "Sage Accounting",
      blurb:
        "Sync invoices + contacts into Sage Business Cloud so your books stay up to date automatically.",
      platformReady: isSageConfigured(),
      accentClass: "from-emerald-500/10 to-teal-500/10",
      category: "accounting",
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
    const isStripe = card.key === "stripe";
    const isSquare = card.key === "square";
    const isGcal = card.key === "google_calendar";
    const isSage = card.key === "sage";
    const hasLiveOAuth = isGcal || isSage || isStripe || isSquare;

    // Stripe state lives on organizations, not integration_connections
    const stripeConnected = Boolean(stripeInfo?.stripe_account_id);
    const stripeFullyEnabled =
      stripeConnected &&
      stripeInfo?.stripe_charges_enabled &&
      stripeInfo?.stripe_payouts_enabled;
    const stripeNeedsAction =
      stripeConnected && !stripeFullyEnabled;

    const conn = byProvider.get(card.key);
    const isConnected = isStripe
      ? stripeConnected
      : conn?.status === "active";

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
                  {isStripe ? (
                    <>
                      {stripeInfo?.stripe_account_id && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Account</dt>
                          <dd className="font-mono text-foreground">
                            {stripeInfo.stripe_account_id.length > 24
                              ? stripeInfo.stripe_account_id.slice(0, 24) + "…"
                              : stripeInfo.stripe_account_id}
                          </dd>
                        </div>
                      )}
                      {stripeInfo?.stripe_connected_at && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">Since</dt>
                          <dd className="text-foreground">
                            {formatDateTime(stripeInfo.stripe_connected_at)}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Charges</dt>
                        <dd className={stripeInfo?.stripe_charges_enabled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                          {stripeInfo?.stripe_charges_enabled ? "Enabled" : "Pending"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Payouts</dt>
                        <dd className={stripeInfo?.stripe_payouts_enabled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                          {stripeInfo?.stripe_payouts_enabled ? "Enabled" : "Pending"}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </dl>
                {isStripe && stripeNeedsAction && (
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-200">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <span>
                        {!stripeInfo?.stripe_details_submitted
                          ? "Finish onboarding in Stripe to start accepting payments."
                          : "Stripe is still verifying your account. This can take a few minutes to a few days."}
                      </span>
                    </div>
                  </div>
                )}
                {isStripe ? (
                  <>
                    {stripeNeedsAction && (
                      <Link
                        href="/api/integrations/stripe/connect"
                        className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:bg-foreground/90 transition-colors"
                      >
                        Continue onboarding
                      </Link>
                    )}
                    <StripeDisconnectButton />
                  </>
                ) : isSquare ? (
                  <form
                    action="/api/integrations/square/disconnect"
                    method="post"
                  >
                    <button
                      type="submit"
                      className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                      Disconnect
                    </button>
                  </form>
                ) : hasLiveOAuth ? (
                  <form action={isGcal ? disconnectGoogleCalendarAction : disconnectSageAction}>
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
              isStripe ? (
                <Link
                  href="/api/integrations/stripe/connect"
                  className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:bg-foreground/90 transition-colors"
                >
                  Connect {card.name}
                </Link>
              ) : isSquare ? (
                <Link
                  href="/api/integrations/square/connect"
                  className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:bg-foreground/90 transition-colors"
                >
                  Connect {card.name}
                </Link>
              ) : hasLiveOAuth ? (
                <form action={isGcal ? connectGoogleCalendarAction : connectSageAction}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:bg-foreground/90 transition-colors"
                  >
                    Connect {card.name}
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
          <ul className="grid gap-4 md:grid-cols-2">
            {paymentCards.map(renderCard)}
          </ul>
        </div>

        {/* Accounting */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Accounting</h2>
          </div>
          <ul className="grid gap-4 md:grid-cols-2">
            {accountingCards.map(renderCard)}
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
