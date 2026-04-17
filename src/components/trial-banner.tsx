import Link from "next/link";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import type { SubscriptionInfo } from "@/lib/subscription";

/**
 * Persistent banner at the top of the app layout. Shows:
 *  - Trial countdown ("5 days left in your free trial")
 *  - Expired warning ("Your subscription has expired")
 *  - Subscribe CTA (never subscribed)
 *  - Nothing (paid or overridden)
 */
export function TrialBanner({ info }: { info: SubscriptionInfo }) {
  if (info.gate === "overridden") return null;

  // Paid, non-trial active subscription — no banner
  if (info.gate === "active" && info.trialDaysLeft === null) return null;

  // Active trial — show countdown
  if (info.gate === "active" && info.trialDaysLeft !== null) {
    const days = info.trialDaysLeft;
    const urgent = days <= 3;

    return (
      <div
        className={`border-b px-4 py-2.5 text-xs ${
          urgent
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200"
            : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-200"
        }`}
      >
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {urgent ? (
              <Clock className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
            )}
            <p>
              {days === 0 ? (
                <strong>Your free trial ends today.</strong>
              ) : days === 1 ? (
                <strong>1 day left in your free trial.</strong>
              ) : (
                <>
                  <strong>{days} days left</strong> in your free trial.
                </>
              )}
              {" "}
              {urgent
                ? "Subscribe now to keep your data and access."
                : "Enjoying Sollos? Subscribe anytime to continue after the trial."}
            </p>
          </div>
          <Link
            href="/app/settings/billing"
            className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium text-white transition-colors ${
              urgent
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {urgent ? "Subscribe now" : "View plans"}
          </Link>
        </div>
      </div>
    );
  }

  // Never subscribed — soft CTA
  if (info.gate === "none") {
    return (
      <div className="border-b border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-200">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3">
          <p>
            <strong>Welcome to Sollos!</strong> Start your 14-day free trial to
            unlock all features.
          </p>
          <Link
            href="/app/settings/billing"
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Start free trial
          </Link>
        </div>
      </div>
    );
  }

  // Expired
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-200">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <p>
            <strong>Your subscription has expired.</strong> You can still view
            your data, but creating new bookings, invoices, and estimates is
            disabled until you subscribe.
          </p>
        </div>
        <Link
          href="/app/settings/billing"
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
        >
          Subscribe now
        </Link>
      </div>
    </div>
  );
}
