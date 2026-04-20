import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = {
  title: "Leave a Review",
  description: "Tell us how we did.",
  robots: { index: false, follow: false },
};

/**
 * Public review page — no login required.
 *
 * The capability is the `review_token` on the invoice. When an invoice is
 * paid, the notify_invoice_paid trigger creates a notification linking to
 * /app/invoices/:id. The owner can then generate a review link (which sets
 * review_token) and share it with the client.
 *
 * We also support arriving here directly if review_token was pre-generated.
 */
export default async function PublicReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const rl = await checkIpRateLimit("review-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  // Find the invoice by review_token (column not yet in generated types).
  // First find the invoice ID via the token, then fetch full details.
  const { data: tokenMatch } = (await admin
    .from("invoices")
    .select("id" as never)
    .eq("review_token" as never, token)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  if (!tokenMatch) notFound();

  const { data: invoice } = (await admin
    .from("invoices")
    .select(
      `
      id, number, organization_id, client_id,
      organization:organizations ( id, name ),
      client:clients ( name )
    `,
    )
    .eq("id", tokenMatch.id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      number: string | null;
      organization_id: string;
      client_id: string | null;
      organization: {
        id: string;
        name: string;
      } | null;
      client: { name: string } | null;
    } | null;
  };

  if (!invoice) notFound();

  // Fetch branding separately (columns not yet in generated types)
  const orgId = invoice.organization?.id;
  let orgBranding: { logo_url: string | null; brand_color: string | null } = {
    logo_url: null,
    brand_color: null,
  };
  if (orgId) {
    const { data } = (await admin
      .from("organizations")
      .select("logo_url, brand_color")
      .eq("id", orgId)
      .maybeSingle()) as unknown as {
      data: { logo_url: string | null; brand_color: string | null } | null;
    };
    if (data) orgBranding = data;
  }

  // Check if a review already exists for this invoice
  const { data: existingReview } = await admin
    .from("reviews")
    .select("id, rating, comment")
    .eq("organization_id", invoice.organization_id)
    .eq("client_id", invoice.client_id ?? "")
    .maybeSingle();

  const orgName = invoice.organization?.name ?? "our team";
  const logoUrl = orgBranding.logo_url;
  const brandColor = orgBranding.brand_color
    ? `#${orgBranding.brand_color}`
    : "#6366f1";

  return (
    <main className="sollos-wash relative flex flex-1 justify-center px-4 py-10">
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-lg">
        {/* Brand */}
        <div className="mx-auto mb-6 flex w-max items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl || "/sollos-logo.png"}
            alt={orgName}
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
          <span className="text-base font-semibold tracking-tight">
            {orgName}
          </span>
        </div>

        <div className="sollos-card p-6 shadow-lg shadow-indigo-500/5 sm:p-8">
          {existingReview ? (
            <div className="text-center">
              <div className="mx-auto mb-3 flex w-max gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <span
                    key={s}
                    className={`text-2xl ${s <= existingReview.rating ? "text-amber-400" : "text-muted-foreground/20"}`}
                  >
                    ★
                  </span>
                ))}
              </div>
              <h1 className="text-xl font-bold">Thank you for your review!</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Your feedback helps {orgName} provide better service.
              </p>
              {existingReview.comment && (
                <blockquote className="mt-4 rounded-md border border-border bg-muted/20 px-4 py-3 text-sm italic text-muted-foreground">
                  &ldquo;{existingReview.comment}&rdquo;
                </blockquote>
              )}
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-xl font-bold">How did we do?</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Thanks for choosing {orgName}! We&apos;d love your feedback.
                </p>
              </div>

              <ReviewForm
                token={token}
                invoiceId={invoice.id}
                orgName={orgName}
                brandColor={brandColor}
                clientName={invoice.client?.name ?? null}
              />
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Your review helps {orgName} improve their service.
        </p>
      </div>
    </main>
  );
}
