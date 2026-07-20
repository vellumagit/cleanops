import { Lock, Download, Sparkles, CreditCard } from "lucide-react";
import type { SubscriptionInfo } from "@/lib/subscription";
import {
  SubscribeButton,
  ManageInStripeButton,
} from "@/app/app/settings/billing/billing-actions";

/**
 * Full-screen hard wall shown in place of the entire /app shell when an org's
 * subscription gate is "expired" (trial elapsed, or past-due grace run out).
 *
 * This is the single chokepoint — the app layout renders THIS instead of the
 * sidebar + page, so no /app route is reachable. The only ways forward are:
 *   - subscribe / update the card (owners & admins),
 *   - export all data (owners & admins) — never hold records hostage,
 *   - log out (everyone).
 *
 * Crews are unaffected: the field app (/field) has no such wall by design.
 */
export function TrialEndedWall({
  info,
  role,
  orgName,
}: {
  info: SubscriptionInfo;
  role: string;
  orgName: string;
}) {
  const canManageBilling = role === "owner" || role === "admin";
  const isPastDue = info.status === "past_due";

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
          <Lock className="h-6 w-6 text-amber-600" />
        </div>

        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          {isPastDue
            ? "Your subscription is past due"
            : "Your free trial has ended"}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {isPastDue ? (
            <>
              We couldn&apos;t process the latest payment for{" "}
              <strong className="text-foreground">{orgName}</strong> and the
              grace period has ended. Update your payment method to restore
              access — your data is safe and waiting.
            </>
          ) : (
            <>
              Access to <strong className="text-foreground">{orgName}</strong>{" "}
              is paused. Subscribe to pick up right where you left off — nothing
              has been deleted, and every record is exactly as you left it.
            </>
          )}
        </p>

        {canManageBilling ? (
          <div className="mt-6 space-y-4">
            {isPastDue ? (
              <div>
                <ManageInStripeButton />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5" />
                  Update your card in the Stripe billing portal.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <SubscribeButton
                    plan="growth"
                    label="Subscribe to Growth — $99/mo"
                    variant="default"
                  />
                  <SubscribeButton
                    plan="starter"
                    label="Starter — $49/mo"
                    variant="outline"
                  />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  All plans include every feature. Cancel anytime.
                </p>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <a
                href="/api/export"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
              >
                <Download className="h-3.5 w-3.5" />
                Download all your data
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                A full JSON export of everything your organization owns. Yours
                to keep, whether or not you continue.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm text-foreground">
              Your workspace is paused.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask the organization owner or an admin to reactivate the
              subscription. You&apos;ll have full access again the moment
              billing is sorted out.
            </p>
          </div>
        )}

        {/* Logout MUST be a POST form — a GET/Link would let the prefetcher
            silently sign the user out. */}
        <form action="/auth/logout" method="post" className="mt-6">
          <button
            type="submit"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
