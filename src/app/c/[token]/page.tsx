import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents, formatDate, humanizeEnum } from "@/lib/format";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { SignForm } from "./sign-form";

export const metadata: Metadata = {
  title: "Sign contract",
  description: "Review and sign your service contract.",
  robots: { index: false, follow: false },
};

/**
 * Public contract sign page. No auth — the caller is the end client,
 * who has no Sollos account. The token in the URL IS the capability.
 *
 * Flow:
 *   - GET /c/<token> — shows terms + sign form (or signed thank-you
 *     if already completed)
 *   - POST via sign-actions.signContractAction records the signature
 *     and redirects back here with ?signed=1
 */
export default async function PublicContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ signed?: string }>;
}) {
  const { token } = await params;
  const { signed } = await searchParams;
  if (!token || token.length < 8) notFound();

  // Rate limit by IP — same cadence as the invoice public page.
  const rl = await checkIpRateLimit("contract-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  // Tax / signature columns aren't in generated types — fetch with
  // an explicit cast. Base columns + joins are typed normally.
  const { data: contract } = (await admin
    .from("contracts")
    .select(
      `
        id, organization_id, service_type, start_date, end_date,
        agreed_price_cents, payment_terms, created_at,
        client:clients ( name ),
        organization:organizations ( name )
      `,
    )
    .eq("public_token" as never, token as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      organization_id: string;
      service_type: string;
      start_date: string;
      end_date: string | null;
      agreed_price_cents: number;
      payment_terms: string | null;
      created_at: string;
      client: { name: string | null } | null;
      organization: { name: string | null } | null;
    } | null;
  };

  if (!contract) notFound();

  // Read sign status + signed_at separately (not in generated types).
  const { data: signInfo } = (await admin
    .from("contracts")
    .select("sign_status, signed_at, signer_name")
    .eq("id", contract.id)
    .maybeSingle()) as unknown as {
    data: {
      sign_status: string;
      signed_at: string | null;
      signer_name: string | null;
    } | null;
  };

  const currency = await getOrgCurrency(contract.organization_id);
  const orgName = contract.organization?.name ?? "the business";
  const clientName = contract.client?.name ?? "";
  const isSigned = signInfo?.sign_status === "signed";
  const showThankYou = isSigned || signed === "1";

  // Pull branding columns separately — logo/brand_color aren't in the
  // generated types yet.
  const { data: branding } = (await admin
    .from("organizations")
    .select("logo_url, brand_color")
    .eq("id", contract.organization_id)
    .maybeSingle()) as unknown as {
    data: { logo_url: string | null; brand_color: string | null } | null;
  };
  const brandCss = branding?.brand_color
    ? ({
        "--brand": `#${branding.brand_color}`,
      } as React.CSSProperties)
    : {};

  return (
    <main
      className="sollos-wash relative flex flex-1 justify-center px-4 py-10"
      style={brandCss}
    >
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-2xl">
        {/* Brand header */}
        <div className="mx-auto mb-6 flex w-max items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={branding?.logo_url || "/sollos-logo.png"}
            alt={orgName}
            className="h-10 w-10 shrink-0 rounded-lg object-contain"
          />
          <span className="text-lg font-semibold tracking-tight">
            {orgName}
          </span>
        </div>

        <div className="sollos-card overflow-hidden shadow-lg sm:p-0">
          <div
            className="h-1.5 w-full"
            style={{ backgroundColor: "var(--brand, #6366f1)" }}
          />
          <div className="p-6 sm:p-8">
            <div className="border-b border-border pb-5">
              <p className="sollos-label">Service contract</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {humanizeEnum(contract.service_type)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Between <strong>{orgName}</strong> and{" "}
                <strong>{clientName}</strong>
              </p>
            </div>

            {/* Terms grid */}
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="sollos-label">Start date</dt>
                <dd className="mt-0.5 font-medium">
                  {formatDate(contract.start_date)}
                </dd>
              </div>
              <div>
                <dt className="sollos-label">End date</dt>
                <dd className="mt-0.5 font-medium">
                  {contract.end_date
                    ? formatDate(contract.end_date)
                    : "Open-ended"}
                </dd>
              </div>
              <div>
                <dt className="sollos-label">Agreed price</dt>
                <dd className="mt-0.5 font-semibold text-lg tabular-nums">
                  {formatCurrencyCents(contract.agreed_price_cents, currency)}
                </dd>
              </div>
              <div>
                <dt className="sollos-label">Payment terms</dt>
                <dd className="mt-0.5 font-medium">
                  {contract.payment_terms || "As agreed"}
                </dd>
              </div>
            </dl>

            {/* Sign block OR signed confirmation */}
            {showThankYou ? (
              <div className="mt-8 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                <h2 className="mt-3 text-lg font-semibold">
                  Contract signed
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Signed by{" "}
                  <strong className="text-foreground">
                    {signInfo?.signer_name}
                  </strong>
                  {signInfo?.signed_at ? (
                    <>
                      {" on "}
                      {new Date(signInfo.signed_at).toLocaleDateString(
                        "en-US",
                        {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </>
                  ) : null}
                  . You can close this tab — we&rsquo;ll email you a copy for
                  your records.
                </p>
              </div>
            ) : (
              <div className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Sign this contract
                </h2>
                <div className="mt-4">
                  <SignForm
                    token={token}
                    orgName={orgName}
                    clientName={clientName}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Questions? Contact {orgName} directly — this is a secure signing
          page and does not accept messages.
        </p>
      </div>
    </main>
  );
}
