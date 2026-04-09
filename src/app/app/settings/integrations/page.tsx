import Link from "next/link";
import { ArrowLeft, CheckCircle2, Plug, XCircle } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  isQuickBooksConfigured,
  isStripeConnectConfigured,
  isSquareConfigured,
} from "@/lib/env";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Integrations" };

type ProviderKey = "stripe" | "square" | "quickbooks";

type ProviderCard = {
  key: ProviderKey;
  name: string;
  blurb: string;
  platformReady: boolean;
  accentClass: string;
};

/**
 * Integrations page — Phase 12 Part 1.
 *
 * Shows the three supported payment processors as cards. Each card has
 * three possible states:
 *
 *   1. "Coming soon" — Sollos hasn't registered the OAuth app with that
 *      provider yet (no platform env vars). This is the default until
 *      the founder walks through the 5-min signup on each provider's
 *      dashboard and sets the env vars in Vercel.
 *
 *   2. "Not connected" — platform creds exist, but this org hasn't
 *      clicked "Connect". We'd show a Connect button that kicks off
 *      OAuth — disabled in Part 1 until the callback routes are wired.
 *
 *   3. "Connected" — this org has an active `integration_connections`
 *      row. Shows when it was connected and a disconnect button.
 *
 * The cards are intentionally boring — the interesting behaviour lives
 * in the OAuth callback routes we'll build in Part 2.
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

  const cards: ProviderCard[] = [
    {
      key: "stripe",
      name: "Stripe",
      blurb:
        "Accept cards, Apple Pay, Google Pay, ACH. Funds land in your bank in 2 business days.",
      platformReady: isStripeConnectConfigured(),
      accentClass: "from-violet-500/10 to-indigo-500/10",
    },
    {
      key: "square",
      name: "Square",
      blurb:
        "Accept cards with next-day deposits. Best if you already use Square in-person.",
      platformReady: isSquareConfigured(),
      accentClass: "from-teal-500/10 to-emerald-500/10",
    },
    {
      key: "quickbooks",
      name: "QuickBooks Online",
      blurb:
        "Sync invoices + customers into QuickBooks so your bookkeeper isn't doing double entry.",
      platformReady: isQuickBooksConfigured(),
      accentClass: "from-lime-500/10 to-green-500/10",
    },
  ];

  return (
    <PageShell
      title="Integrations"
      description="Connect a payment processor so clients can pay online."
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
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <Plug className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">
                Sollos never holds your money.
              </p>
              <p className="mt-1">
                When a client pays an invoice, the money moves directly
                from them to the processor account you connect here. We
                just read the webhook so the invoice shows as paid.
              </p>
            </div>
          </div>
        </div>

        <ul className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => {
            const conn = byProvider.get(card.key);
            const isConnected = conn?.status === "active";
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
                              <dt className="text-muted-foreground">
                                Account
                              </dt>
                              <dd className="font-mono text-foreground">
                                {conn.external_account_id.slice(0, 16)}…
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
                        <button
                          type="button"
                          disabled
                          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground"
                        >
                          <XCircle className="h-3 w-3" />
                          Disconnect
                        </button>
                      </>
                    ) : card.platformReady ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex w-full items-center justify-center rounded-md border border-dashed border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted-foreground"
                        title="OAuth handoff wiring in progress"
                      >
                        Connect {card.name} — wiring up
                      </button>
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
          })}
        </ul>
      </div>
    </PageShell>
  );
}
