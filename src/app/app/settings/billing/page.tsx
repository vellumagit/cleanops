import Link from "next/link";
import {
  ChevronLeft,
  CreditCard,
  Sparkles,
  Check,
  ArrowUp,
  Building2,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isStripeEnabled, getPlanFromPriceId } from "@/lib/stripe";
import { PageShell } from "@/components/page-shell";
import { RedeemForm } from "./redeem-form";
import { ManageInStripeButton, SubscribeButton } from "./billing-actions";

export const metadata = { title: "Billing" };

type PlanKey = "starter" | "growth" | "enterprise";

type PlanDef = {
  key: PlanKey;
  name: string;
  price: string;
  cadence: string;
  employees: string;
  tagline: string;
  features: string[];
  highlight?: boolean;
};

/**
 * Plan definitions — kept in sync with the marketing page (/) pricing
 * section so prospects see the same lineup before and after they sign
 * up. If you tweak features here, mirror the change in src/app/page.tsx.
 */
const PLANS: PlanDef[] = [
  {
    key: "starter",
    name: "Starter",
    price: "$49",
    cadence: "/month",
    employees: "Up to 5 employees",
    tagline: "For solo owners and small crews.",
    features: [
      "All features, zero restrictions",
      "Unlimited clients and jobs",
      "Unlimited invoices",
      "Team chat and clock-in",
      "Freelancer bench SMS",
      "Google Calendar sync",
      "Email support",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "$99",
    cadence: "/month",
    employees: "Up to 25 employees",
    tagline: "For established cleaning operations.",
    features: [
      "Everything in Starter",
      "Priority email support",
      "Onboarding call included",
      "Advanced reports and exports",
      "Custom branding on invoices",
      "Bulk import of clients & jobs",
    ],
    highlight: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    employees: "25+ employees",
    tagline: "For large operations with custom needs.",
    features: [
      "Everything in Growth",
      "Unlimited employees",
      "Dedicated account manager",
      "Custom integrations",
      "SSO (single sign-on)",
      "Priority phone support",
      "Custom training for your team",
      "SLA and uptime guarantees",
    ],
  },
];

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
      "status, current_period_end, cancel_at_period_end, trial_ends_at, stripe_price_id, stripe_subscription_id",
    )
    .eq("organization_id", membership.organization_id)
    .maybeSingle();
  const hasSubscription = Boolean(subscription?.stripe_subscription_id);
  const currentPlan = getPlanFromPriceId(subscription?.stripe_price_id ?? null);

  // billing_override may not be in generated types yet — read via admin.
  const admin = createSupabaseAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("billing_override, billing_override_at")
    .eq("id", membership.organization_id)
    .maybeSingle();

  const override = orgRow as {
    billing_override: "free_forever" | "comp" | null;
    billing_override_at: string | null;
  } | null;

  const hasOverride = Boolean(override?.billing_override);
  const enabled = isStripeEnabled();
  const inTrial =
    subscription?.trial_ends_at &&
    new Date(subscription.trial_ends_at).getTime() > Date.now();

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
      {hasOverride && (
        <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span className="font-medium">
              {override?.billing_override === "free_forever"
                ? "Free forever"
                : "Comped account"}
            </span>
          </div>
          <p className="mt-1 pl-6">
            This account is not billed. Activated on{" "}
            {formatDate(override?.billing_override_at ?? null)}.
          </p>
        </div>
      )}

      {!enabled && !hasOverride && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
          Billing is scaffolded but not yet enabled in this environment. Set{" "}
          <code>STRIPE_ENABLED=true</code> in Vercel to start charging.
        </div>
      )}

      {/* ─── Current plan summary ─────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Current plan</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {membership.organization_name}
                </p>
              </div>
              {inTrial && !hasOverride && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  Trial
                </span>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="mt-0.5 font-medium capitalize">
                  {hasOverride
                    ? override?.billing_override === "free_forever"
                      ? "Free forever"
                      : "Comped"
                    : currentPlan
                      ? currentPlan
                      : formatStatus(subscription?.status ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {subscription?.cancel_at_period_end ? "Cancels" : "Renews"}
                </dt>
                <dd className="mt-0.5 font-medium">
                  {hasOverride
                    ? "Never"
                    : formatDate(subscription?.current_period_end ?? null)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd className="mt-0.5 font-medium">
                  {hasOverride
                    ? "—"
                    : formatDate(subscription?.trial_ends_at ?? null)}
                </dd>
              </div>
            </dl>

            {!hasOverride && enabled && hasSubscription && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <ManageInStripeButton />
                <p className="text-xs text-muted-foreground">
                  Update payment method, download invoices, or cancel in
                  Stripe.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Plan comparison ──────────────────────────────────────────── */}
      {!hasOverride && enabled && (
        <div className="mt-6 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {hasSubscription ? "Switch your plan" : "Choose your plan"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {hasSubscription
                ? "Upgrade or downgrade anytime. Prorated automatically."
                : "14-day free trial · No credit card today."}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan) => {
              const isCurrent = currentPlan === plan.key;
              const isHigherThanCurrent =
                currentPlan === "starter" &&
                (plan.key === "growth" || plan.key === "enterprise");
              const isLowerThanCurrent =
                currentPlan === "growth" && plan.key === "starter";

              return (
                <div
                  key={plan.key}
                  className={`relative flex flex-col rounded-2xl border bg-card p-5 ${
                    isCurrent
                      ? "border-foreground shadow-md"
                      : plan.highlight
                        ? "border-foreground/40"
                        : "border-border"
                  }`}
                >
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-background">
                        Current plan
                      </span>
                    </div>
                  )}
                  {!isCurrent && plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-amber-500 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                        Most popular
                      </span>
                    </div>
                  )}

                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                      {plan.key === "enterprise" && (
                        <Building2 className="h-3.5 w-3.5 text-indigo-500" />
                      )}
                      {plan.name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {plan.tagline}
                    </p>
                  </div>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold tracking-tight">
                      {plan.price}
                    </span>
                    {plan.cadence && (
                      <span className="text-xs text-muted-foreground">
                        {plan.cadence}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] font-medium text-foreground">
                    {plan.employees}
                  </p>

                  <ul className="mt-4 flex-1 space-y-1.5 text-xs">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-1.5 text-muted-foreground"
                      >
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-5">
                    {/* CTA logic:
                        - Enterprise → mailto contact sales
                        - On this plan → "Current plan" badge, disabled
                        - On a different plan → Stripe portal (upgrades and
                          downgrades go through Billing Portal — prorated
                          automatically by Stripe)
                        - No subscription yet → SubscribeButton (checkout) */}
                    {plan.key === "enterprise" ? (
                      <a
                        href="mailto:sales@sollos3.com?subject=Enterprise%20inquiry"
                        className="inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        Contact sales
                      </a>
                    ) : isCurrent ? (
                      <button
                        disabled
                        className="inline-flex w-full items-center justify-center rounded-md border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground"
                      >
                        Current plan
                      </button>
                    ) : hasSubscription ? (
                      <ManageInStripeButton />
                    ) : (
                      <SubscribeButton
                        plan={plan.key}
                        label={
                          plan.highlight
                            ? `Start ${plan.name} trial`
                            : `Start ${plan.name}`
                        }
                        variant={plan.highlight ? "default" : "outline"}
                      />
                    )}

                    {hasSubscription && isHigherThanCurrent && (
                      <p className="mt-2 flex items-center justify-center gap-1 text-[10px] font-medium text-emerald-600">
                        <ArrowUp className="h-3 w-3" />
                        Upgrade in Stripe portal
                      </p>
                    )}
                    {hasSubscription && isLowerThanCurrent && (
                      <p className="mt-2 text-center text-[10px] text-muted-foreground">
                        Downgrade in Stripe portal
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            All plans include every feature — no hidden upgrades. Need
            something different?{" "}
            <a
              href="mailto:hello@sollos3.com?subject=Plan%20question"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Email us
            </a>
            .
          </p>
        </div>
      )}

      {!hasOverride && <RedeemForm />}
    </PageShell>
  );
}
