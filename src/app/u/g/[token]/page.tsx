/**
 * Google review email unsubscribe.
 *
 *   GET /u/g/<token>  →  Sets gbp_unsubscribed_at + flips state to
 *                        "opted_out"; renders a confirmation page.
 *
 * Scoped to the Google-review track ONLY — the customer still receives
 * booking confirmations, receipts, reminders, etc. That's the explicit
 * promise in the email footer; flipping a master "no emails" toggle
 * here would surprise people who only meant to silence one stream.
 *
 * Token is separate from the click-redirect token so leaking one in
 * analytics / log data doesn't reveal the unsub capability.
 */

import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { unsubscribeGbpByToken } from "@/lib/gbp-unsubscribe";

export const metadata = { title: "Unsubscribed" };

export default async function GbpUnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rate-limit by IP. Without this, an attacker iterating
  // gbp_unsubscribe_token guesses could silently opt out every
  // customer in the system.
  const rl = await checkIpRateLimit("gbp-unsubscribe", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const result = await unsubscribeGbpByToken(token);
  const success = result.ok;
  const alreadyUnsubscribed = result.already;
  const orgName = result.orgName;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12 text-center">
      {success ? (
        <>
          <h1 className="text-xl font-semibold">
            {alreadyUnsubscribed
              ? "You're already unsubscribed"
              : "You're unsubscribed"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {orgName ? `${orgName} won't` : "We won't"} send you any more Google
            review request emails. You&apos;ll still receive booking
            confirmations, receipts, and reminders.
          </p>
          <p className="mt-6 text-xs text-muted-foreground">
            Changed your mind? Just reply to any of {orgName ?? "our"}&apos;s
            emails and ask to be re-added.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Link not recognized</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This unsubscribe link is invalid or has already been processed. If
            you&apos;re still receiving review-request emails you didn&apos;t
            want, please reply to any of them and ask to be removed.
          </p>
        </>
      )}
    </div>
  );
}
