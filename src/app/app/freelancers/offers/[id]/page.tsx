import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { CancelOfferForm } from "./cancel-form";

export const metadata = { title: "Job offer" };

type OfferStatus = "open" | "filled" | "cancelled" | "expired";

function offerTone(status: OfferStatus): StatusTone {
  switch (status) {
    case "open":
      return "blue";
    case "filled":
      return "green";
    case "cancelled":
      return "red";
    case "expired":
      return "amber";
  }
}

function claimBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export default async function JobOfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireMembership(["owner", "admin", "manager"]);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: offer, error } = await supabase
    .from("job_offers")
    .select(
      `
        id,
        status,
        pay_cents,
        notes,
        expires_at,
        filled_at,
        created_at,
        filled_contact_id,
        booking:bookings (
          id, scheduled_at, duration_minutes, service_type, address,
          client:clients ( id, name )
        ),
        posted_by:memberships!job_offers_posted_by_fkey (
          id, profile:profiles ( full_name )
        )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!offer) notFound();

  const { data: dispatches } = await supabase
    .from("job_offer_dispatches")
    .select(
      `
        id,
        claim_token,
        delivery_status,
        delivery_error,
        sent_at,
        responded_at,
        contact:freelancer_contacts ( id, full_name, phone )
      `,
    )
    .eq("offer_id", id)
    .order("sent_at", { ascending: true });

  // Fetch positions data (columns not in generated types yet).
  const { data: posData } = await supabase
    .from("job_offers")
    .select("positions_needed, positions_filled" as never)
    .eq("id", id)
    .maybeSingle();
  const posRow = posData as Record<string, number> | null;
  const positionsNeeded = posRow?.positions_needed ?? 1;
  const positionsFilled = posRow?.positions_filled ?? 0;

  // Fetch all claims for this offer to know which contacts claimed.
  const { data: claims } = await supabase
    .from("job_offer_claims" as never)
    .select("contact_id")
    .eq("offer_id", id);
  const claimedContactIds = new Set(
    ((claims ?? []) as Array<{ contact_id: string }>).map((c) => c.contact_id),
  );

  const status = offer.status as OfferStatus;
  const base = claimBaseUrl();

  return (
    <PageShell
      title="Job offer"
      description={`Broadcast on ${formatDateTime(offer.created_at)}`}
      actions={
        <Link
          href="/app/freelancers/offers"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          All offers
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="sollos-label">Shift</p>
                <h2 className="mt-1 text-lg font-semibold">
                  {humanizeEnum(offer.booking?.service_type ?? null)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDateTime(offer.booking?.scheduled_at ?? null)} ·{" "}
                  {formatDurationMinutes(offer.booking?.duration_minutes ?? null)}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {offer.booking?.client?.name ?? "Unknown client"} ·{" "}
                  {offer.booking?.address ?? "No address"}
                </p>
              </div>
              <StatusBadge tone={offerTone(status)}>
                {humanizeEnum(status)}
              </StatusBadge>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Pay</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
                  {formatCurrencyCents(offer.pay_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Positions</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                  {positionsFilled} / {positionsNeeded} filled
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Expires</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {formatDateTime(offer.expires_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Filled</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {offer.filled_at ? formatDateTime(offer.filled_at) : "—"}
                </dd>
              </div>
            </dl>

            {offer.notes && (
              <div className="mt-5 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="sollos-label mb-1">Notes</p>
                {offer.notes}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
              <Link
                href={`/app/bookings/${offer.booking?.id ?? ""}`}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                View booking
              </Link>
              {status === "open" && <CancelOfferForm id={offer.id} />}
            </div>
          </div>

          {/* Dispatches */}
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-6 py-3">
              <p className="sollos-label">
                Dispatches ({dispatches?.length ?? 0})
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                One row per freelancer who received this offer. Click the
                claim link below to preview what the freelancer sees when
                they tap their text message.
              </p>
            </div>
            <ul className="divide-y divide-border">
              {!dispatches || dispatches.length === 0 ? (
                <li className="px-6 py-6 text-xs text-muted-foreground">
                  No dispatches — this offer was created but not sent.
                </li>
              ) : (
                dispatches.map((d) => {
                  const claimed =
                    d.contact?.id ? claimedContactIds.has(d.contact.id) : false;
                  return (
                    <li
                      key={d.id}
                      className="flex items-start justify-between gap-4 px-6 py-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {d.contact?.full_name ?? "Unknown"}
                        </p>
                        <p className="truncate text-xs tabular-nums text-muted-foreground">
                          {d.contact?.phone ?? ""}
                        </p>
                        <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
                          <Link
                            href={`/claim/${d.claim_token}`}
                            className="hover:text-primary"
                            prefetch={false}
                          >
                            {base}/claim/{d.claim_token}
                          </Link>
                        </p>
                        {d.delivery_error && (
                          <p className="mt-1 text-[11px] text-destructive">
                            {d.delivery_error}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {claimed ? (
                          <StatusBadge tone="green">Claimed</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">
                            {d.delivery_status}
                          </StatusBadge>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {formatDateTime(d.sent_at)}
                        </p>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Posted by</p>
            <p className="mt-2 text-sm font-medium">
              {offer.posted_by?.profile?.full_name ?? "Unknown"}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">How claiming works</p>
            <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
              <li>
                1. Each freelancer received a unique link with an entropy
                token.
              </li>
              <li>
                2. {positionsNeeded > 1
                  ? `Up to ${positionsNeeded} freelancers can claim a spot. The offer stays open until all positions are filled.`
                  : <>The first to tap <Copy className="inline h-3 w-3" /> and claim wins — the offer state flips to <code className="font-mono text-[11px]">filled</code> atomically.</>}
              </li>
              <li>
                3. Freelancers who tap after all spots are taken see a
                &ldquo;sorry, already filled&rdquo; page.
              </li>
              <li>
                4. Freelancers who claim see the full address and client
                details on their claim page.
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
