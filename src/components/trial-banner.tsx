import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { SubscriptionGate } from "@/lib/subscription";

/**
 * Persistent banner rendered at the top of the app layout when the org's
 * subscription isn't in good standing. Server component — no client JS.
 */
export function TrialBanner({ gate }: { gate: SubscriptionGate }) {
  if (gate === "active" || gate === "overridden") return null;

  if (gate === "none") {
    // Never subscribed — soft CTA, not blocking
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

  // expired — trial ended or subscription canceled
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
