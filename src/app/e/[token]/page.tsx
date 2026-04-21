import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents } from "@/lib/format";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";

export const metadata: Metadata = {
  title: "Estimate",
  description: "View your estimate.",
  robots: { index: false, follow: false },
};

/**
 * Public, no-login estimate view. The capability is the 16-char
 * `public_token` in the URL. Rendered with the service-role client because
 * the caller is the end client (the cleaning company's customer) — no
 * Sollos account.
 *
 * Rate-limited per IP (30/min) to defeat token enumeration.
 */
export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  const rl = await checkIpRateLimit("estimate-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  const { data: estimate } = (await admin
    .from("estimates")
    .select(
      `
        id, organization_id, service_description, notes, total_cents,
        status, pdf_url, expires_at, sent_at,
        client:clients ( name, email ),
        organization:organizations ( name, brand_color, logo_url )
      `,
    )
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      service_description: string | null;
      notes: string | null;
      total_cents: number;
      status: string;
      pdf_url: string | null;
      expires_at: string | null;
      sent_at: string | null;
      client: { name: string | null; email: string | null } | null;
      organization: {
        name: string;
        brand_color: string | null;
        logo_url: string | null;
      } | null;
    } | null;
  };

  if (!estimate) notFound();

  const currency = await getOrgCurrency(estimate.organization_id);
  const orgName = estimate.organization?.name ?? "Your service provider";
  const brandColor =
    estimate.organization?.brand_color ?? "#6366f1";
  const logoUrl = estimate.organization?.logo_url ?? null;

  // Server component — per-request render, so Date.now() here is
  // deterministic for this response.
  const isExpired = estimate.expires_at
    ? // eslint-disable-next-line react-hooks/purity
      new Date(estimate.expires_at).getTime() < Date.now()
    : false;

  return (
    <main className="min-h-screen bg-[#fafafa] py-10 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Branded header */}
        <div className="rounded-t-xl border border-b-0 border-border bg-white px-8 py-6 text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={orgName}
              style={{ maxHeight: 44, height: "auto", width: "auto" }}
              className="mx-auto"
            />
          ) : (
            <div
              style={{ letterSpacing: "-0.025em" }}
              className="text-2xl font-bold text-foreground"
            >
              {orgName}
            </div>
          )}
        </div>

        {/* Card */}
        <div className="rounded-b-xl border border-border bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sollos-hero">
            Your estimate
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            From <strong className="text-foreground">{orgName}</strong>
            {estimate.client?.name ? ` for ${estimate.client.name}` : ""}
          </p>

          {isExpired && (
            <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-800">
              This estimate has expired. Contact {orgName} to request a
              refreshed quote.
            </div>
          )}

          {estimate.status === "approved" && (
            <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-800">
              This estimate has been approved.
            </div>
          )}

          {estimate.status === "declined" && (
            <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3 text-xs text-red-800">
              This estimate was declined.
            </div>
          )}

          {/* Service */}
          {estimate.service_description && (
            <section className="mt-8">
              <p className="sollos-label mb-2">Service</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {estimate.service_description}
              </p>
            </section>
          )}

          {/* Total */}
          <section className="mt-8 rounded-lg border border-border bg-muted/30 p-5">
            <div className="flex items-baseline justify-between">
              <p className="sollos-label">Total</p>
              <p
                className="text-3xl font-bold tracking-tight"
                style={{ color: brandColor }}
              >
                {formatCurrencyCents(estimate.total_cents, currency)}
              </p>
            </div>
            {estimate.expires_at && !isExpired && (
              <p className="mt-1 text-xs text-muted-foreground">
                Valid until{" "}
                {new Date(estimate.expires_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </section>

          {/* Notes */}
          {estimate.notes && (
            <section className="mt-6">
              <p className="sollos-label mb-2">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {estimate.notes}
              </p>
            </section>
          )}

          {/* PDF */}
          {estimate.pdf_url && (
            <section className="mt-6">
              <a
                href={estimate.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-2 text-foreground hover:text-muted-foreground"
              >
                Download the PDF version
              </a>
            </section>
          )}

          {/* CTA */}
          <section className="mt-8 rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-sm text-foreground font-medium">
              Ready to proceed, or have questions?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reply to the email that brought you here and {orgName} will be
              in touch. They&rsquo;ll confirm and schedule your service.
            </p>
          </section>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sent by <strong className="text-foreground">{orgName}</strong> via{" "}
          <a
            href="https://sollos3.com"
            className="underline underline-offset-2"
          >
            Sollos
          </a>
        </p>
      </div>
    </main>
  );
}
