import type { Metadata } from "next";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { RateLimitedPage } from "@/components/rate-limited-page";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = {
  title: "Shift offer",
  description: "Claim a shift offered to you.",
  robots: { index: false, follow: false },
};

/**
 * Public, no-login claim landing page.
 *
 * Reads with the SERVICE-ROLE client because the caller is a freelancer
 * who is not an authenticated Sollos user. The 16-char token in the URL
 * IS the capability — 96 bits of entropy, unique per dispatch.
 *
 * Renders one of several states depending on the offer status and which
 * contact this particular link belongs to:
 *   - open                 → full details + claim button
 *   - filled by this link  → "you got it" with the sensitive details
 *   - filled by someone    → "already claimed" apology
 *   - cancelled            → cancelled notice
 *   - expired              → expired notice
 *   - invalid / missing    → 404-ish fallback
 *
 * Mobile-first — every freelancer will open this from an SMS on a phone.
 */
export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const rl = await checkIpRateLimit("claim-token", 30, 60_000);
  if (!rl.allowed) {
    return <RateLimitedPage retryAfterSeconds={rl.retryAfterSeconds} />;
  }

  const admin = createSupabaseAdminClient();

  const { data: dispatch } = await admin
    .from("job_offer_dispatches")
    .select(
      `
        id, contact_id,
        contact:freelancer_contacts ( id, full_name ),
        offer:job_offers (
          id, status, pay_cents, notes, expires_at, filled_contact_id,
          booking:bookings (
            id, scheduled_at, duration_minutes, service_type,
            address, notes,
            client:clients ( name, phone )
          )
        )
      `,
    )
    .eq("claim_token", token)
    .maybeSingle();

  if (!dispatch || !dispatch.offer || !dispatch.offer.booking) {
    return <Shell><InvalidState /></Shell>;
  }

  // Fetch positions columns separately (not in generated types yet).
  const { data: offerPositions } = await admin
    .from("job_offers")
    .select("positions_needed, positions_filled" as never)
    .eq("id", dispatch.offer.id)
    .maybeSingle();

  const offer = dispatch.offer as typeof dispatch.offer & {
    positions_needed: number;
    positions_filled: number;
  };
  // Merge positions data (defaults for pre-migration rows).
  offer.positions_needed = (offerPositions as Record<string, number> | null)?.positions_needed ?? 1;
  offer.positions_filled = (offerPositions as Record<string, number> | null)?.positions_filled ?? 0;

  const booking = offer.booking;
  // Server component — rendered once per request, so capturing "now" here
  // is deterministic for the response. React 19's purity rule doesn't
  // differentiate Server vs Client Components, so we opt out for this line.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const expiredByClock =
    !!offer.expires_at && new Date(offer.expires_at).getTime() < now;

  // Branch on effective status.
  let view: React.ReactNode;
  if (offer.status === "cancelled") {
    view = <CancelledState />;
  } else if (offer.status === "expired" || (offer.status === "open" && expiredByClock)) {
    view = <ExpiredState />;
  } else if (offer.status === "filled") {
    // Check if THIS contact claimed one of the spots.
    const { data: myClaim } = await admin
      .from("job_offer_claims" as never)
      .select("id")
      .eq("offer_id", offer.id)
      .eq("contact_id", dispatch.contact_id)
      .maybeSingle();

    if (myClaim || offer.filled_contact_id === dispatch.contact_id) {
      view = <GotItState booking={booking} contactName={dispatch.contact?.full_name ?? null} pay={offer.pay_cents} />;
    } else {
      view = <LostRaceState />;
    }
  } else {
    // open + not yet expired → check if this contact already claimed a spot
    const { data: myClaim } = await admin
      .from("job_offer_claims" as never)
      .select("id")
      .eq("offer_id", offer.id)
      .eq("contact_id", dispatch.contact_id)
      .maybeSingle();

    const positionsNeeded = offer.positions_needed ?? 1;
    const positionsFilled = offer.positions_filled ?? 0;
    const spotsRemaining = positionsNeeded - positionsFilled;

    if (myClaim) {
      // Already claimed — show the "you got it" state
      view = <GotItState booking={booking} contactName={dispatch.contact?.full_name ?? null} pay={offer.pay_cents} />;
    } else {
      view = (
        <OpenState
          token={token}
          contactName={dispatch.contact?.full_name ?? null}
          pay={offer.pay_cents}
          booking={booking}
          notes={offer.notes}
          expiresAt={offer.expires_at}
          positionsNeeded={positionsNeeded}
          spotsRemaining={spotsRemaining}
        />
      );
    }
  }

  return <Shell>{view}</Shell>;
}

/* ------------------------------ Layout ------------------------------ */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="sollos-wash relative flex flex-1 items-center justify-center px-4 py-10">
      <div className="sollos-dots absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-md">
        <div className="mx-auto mb-6 flex w-max items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sollos-logo.png"
            alt="Sollos 3"
            className="h-8 w-8 shrink-0 rounded-lg"
          />
          <span className="text-base font-semibold tracking-tight">
            Sollos 3
          </span>
        </div>
        <div className="sollos-card p-6 shadow-lg shadow-indigo-500/5">
          {children}
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          This link was sent to you. Claim your spot before it fills up.
        </p>
      </div>
    </main>
  );
}

/* ------------------------------ States ------------------------------ */

type BookingForClaim = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  service_type: string;
  address: string | null;
  notes: string | null;
  client: { name: string; phone: string | null } | null;
};

function OpenState({
  token,
  contactName,
  pay,
  booking,
  notes,
  expiresAt,
  positionsNeeded = 1,
  spotsRemaining,
}: {
  token: string;
  contactName: string | null;
  pay: number;
  booking: BookingForClaim;
  notes: string | null;
  expiresAt: string | null;
  positionsNeeded?: number;
  spotsRemaining?: number;
}) {
  const spots = spotsRemaining ?? positionsNeeded;
  const isMultiPosition = positionsNeeded > 1;

  return (
    <div className="space-y-5">
      <div>
        <p className="sollos-label">Shift offer</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {contactName ? `Hey ${contactName.split(" ")[0]}, ` : ""}coverage needed
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isMultiPosition
            ? `${spots} of ${positionsNeeded} spot${positionsNeeded === 1 ? "" : "s"} still open. Tap below to claim yours.`
            : "Tap below if you can take it. First come, first served."}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <dl className="space-y-3 text-sm">
          <Row label="Pay">
            <span className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrencyCents(pay)}
            </span>
          </Row>
          <Row label="Service">{humanizeEnum(booking.service_type)}</Row>
          <Row label="When">{formatDateTime(booking.scheduled_at)}</Row>
          <Row label="Duration">
            {formatDurationMinutes(booking.duration_minutes)}
          </Row>
          {isMultiPosition && (
            <Row label="Spots">
              <span className="tabular-nums">
                {spots} of {positionsNeeded} open
              </span>
            </Row>
          )}
          <Row label="Area">
            {shortArea(booking.address) ?? "On-site (shared after claim)"}
          </Row>
        </dl>
      </div>

      {notes && (
        <div className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          <p className="sollos-label mb-1">Notes</p>
          {notes}
        </div>
      )}

      <ClaimForm token={token} />

      {expiresAt && (
        <p className="text-center text-[11px] text-muted-foreground">
          Offer expires {formatDateTime(expiresAt)}
        </p>
      )}
    </div>
  );
}

function GotItState({
  booking,
  contactName,
  pay,
}: {
  booking: BookingForClaim;
  contactName: string | null;
  pay: number;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="sollos-label text-emerald-600 dark:text-emerald-400">
          You got it
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {contactName ? `Nice, ${contactName.split(" ")[0]}!` : "Nice!"} The shift is yours.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here are the full details. Save this page or screenshot it.
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
        <dl className="space-y-3 text-sm">
          <Row label="Pay">
            <span className="text-lg font-bold tabular-nums text-foreground">
              {formatCurrencyCents(pay)}
            </span>
          </Row>
          <Row label="Service">{humanizeEnum(booking.service_type)}</Row>
          <Row label="When">{formatDateTime(booking.scheduled_at)}</Row>
          <Row label="Duration">
            {formatDurationMinutes(booking.duration_minutes)}
          </Row>
          <Row label="Client">{booking.client?.name ?? "—"}</Row>
          {booking.client?.phone && (
            <Row label="Client phone">
              <a
                href={`tel:${booking.client.phone}`}
                className="font-mono text-foreground underline underline-offset-2"
              >
                {booking.client.phone}
              </a>
            </Row>
          )}
        </dl>
      </div>

      {booking.address && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="sollos-label mb-2">Address</p>
          <p className="whitespace-pre-wrap text-sm font-medium text-foreground">
            {booking.address}
          </p>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(booking.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            Open in Google Maps →
          </a>
        </div>
      )}

      {booking.notes && (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          <p className="sollos-label mb-1">Job notes</p>
          {booking.notes}
        </div>
      )}
    </div>
  );
}

function LostRaceState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">Already claimed</h1>
      <p className="text-sm text-muted-foreground">
        Another freelancer grabbed this shift before you. Thanks for
        checking — we&apos;ll send the next one your way.
      </p>
    </div>
  );
}

function CancelledState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">Offer cancelled</h1>
      <p className="text-sm text-muted-foreground">
        This shift was cancelled by the company. Nothing to do here.
      </p>
    </div>
  );
}

function ExpiredState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">Offer expired</h1>
      <p className="text-sm text-muted-foreground">
        This offer is no longer open. Keep an eye on your texts for the
        next one.
      </p>
    </div>
  );
}

function InvalidState() {
  return (
    <div className="space-y-3 text-center">
      <h1 className="text-xl font-bold tracking-tight">Link not valid</h1>
      <p className="text-sm text-muted-foreground">
        This claim link isn&apos;t recognized. If you got it from a text
        message, try opening it again directly from the SMS.
      </p>
    </div>
  );
}

/* ------------------------------ Helpers ------------------------------ */

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

function shortArea(address: string | null): string | null {
  if (!address) return null;
  // Show just the first line (street name or neighborhood) pre-claim.
  // We do NOT want the house number or full apartment floating around on
  // a link that could be forwarded.
  const first = address.split("\n")[0]?.trim();
  if (!first) return null;
  // Strip the leading number so the exact building isn't exposed.
  const stripped = first.replace(/^\d+[\s-]*/, "").trim();
  return stripped.length > 0 ? stripped : first;
}
