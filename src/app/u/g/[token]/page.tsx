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

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Unsubscribed" };

export default async function GbpUnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let orgName: string | null = null;
  let success = false;
  let alreadyUnsubscribed = false;

  if (token && token.length >= 8 && token.length <= 64) {
    const admin = createSupabaseAdminClient();
    const { data: client } = (await admin
      .from("clients")
      .select(
        "id, gbp_unsubscribed_at, gbp_review_state, organization:organizations ( name )",
      )
      .eq("gbp_unsubscribe_token" as never, token as never)
      .maybeSingle()) as unknown as {
      data: {
        id: string;
        gbp_unsubscribed_at: string | null;
        gbp_review_state: string;
        organization: { name: string } | null;
      } | null;
    };

    if (client) {
      orgName = client.organization?.name ?? null;
      if (client.gbp_unsubscribed_at) {
        alreadyUnsubscribed = true;
        success = true;
      } else {
        // Idempotent: setting state to opted_out from any active state
        // stops the cron from picking them up. We leave clicked/reviewed
        // alone since those are already terminal — no point downgrading.
        const shouldFlipState = ["never_asked", "pending"].includes(
          client.gbp_review_state,
        );
        await admin
          .from("clients")
          .update({
            gbp_unsubscribed_at: new Date().toISOString(),
            ...(shouldFlipState ? { gbp_review_state: "opted_out" } : {}),
          } as never)
          .eq("id", client.id);
        success = true;
      }
    }
  }

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
