import Link from "next/link";
import { ChevronLeft, CreditCard, ExternalLink } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isStripeEnabled } from "@/lib/stripe";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Billing" };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatStatus(status: string | null): string {
  if (!status) return "No subscription";
  return status.replace(/_/g, " ");
}

export default async function BillingPage() {
  const membership = await requireMembership(["owner", "admin"]);

  const supabase = await createSupabaseServerClient();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      "status, current_period_end, cancel_at_period_end, trial_ends_at, stripe_price_id",
    )
    .eq("organization_id", membership.organization_id)
    .maybeSingle();

  const enabled = isStripeEnabled();

  return (
    <PageShell
      title="Billing"
      description="Plan, payment method, and invoices."
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
      {!enabled && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
          Billing is scaffolded but not yet enabled in this environment. The
          Stripe webhook route, the <code>subscriptions</code> table, and this
          page are all live — set <code>STRIPE_ENABLED=true</code> and wire up
          the Stripe SDK to start charging.
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Current plan</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {membership.organization_name}
            </p>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="mt-0.5 font-medium capitalize">
                  {formatStatus(subscription?.status ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Renews</dt>
                <dd className="mt-0.5 font-medium">
                  {subscription?.cancel_at_period_end
                    ? `Cancels ${formatDate(subscription.current_period_end)}`
                    : formatDate(subscription?.current_period_end ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd className="mt-0.5 font-medium">
                  {formatDate(subscription?.trial_ends_at ?? null)}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled
                className={buttonVariants({ size: "sm" })}
                title={
                  enabled
                    ? "Open Stripe customer portal"
                    : "Enable Stripe to use the customer portal"
                }
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Manage in Stripe
              </button>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? "You'll be redirected to Stripe to update payment method and download invoices."
                  : "Available once Stripe is enabled."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
