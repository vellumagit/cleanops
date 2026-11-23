import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkIpRateLimit } from "@/lib/rate-limit-helpers";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { memberDisplayName } from "@/lib/member-display";
import { clientBookingActions } from "@/lib/client-job-requests";
import { brandButtonColors } from "@/lib/readable-on";
import { visitByToken } from "@/lib/visit-link";
import { visitMoveState } from "@/lib/visit-move";
import { VisitActions } from "./visit-actions";

export const metadata = { title: "Your clean", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One visit, for the client it belongs to, opened from the button in a
 * booking email. No sign-in: holding the link is the permission, as it is
 * for an invoice or an estimate (lib/visit-link.ts).
 *
 * Built to the client screens' rules (docs/online-booking-roadmap.md): the
 * cleaning company's name and colour, large type, one thing at a time, and
 * a phone number for anyone who would rather talk to a person.
 */
export default async function VisitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const limit = await checkIpRateLimit("visit-link", 60, 60_000);
  if (!limit.allowed) {
    return (
      <Frame>
        <h1 className="text-2xl font-bold">One moment</h1>
        <p className="mt-2 text-base text-muted-foreground">That&rsquo;s a lot of visits to this page. Wait a minute and open the link again.</p>
      </Frame>
    );
  }

  const visit = await visitByToken(token);
  if (!visit) {
    return (
      <Frame>
        <h1 className="text-2xl font-bold">This link has stopped working</h1>
        <p className="mt-2 text-base text-muted-foreground">
          It may be for a visit that is long past. To see your cleans, type your email on the next page and we&rsquo;ll
          send you a new link.
        </p>
        <Link
          href="/client/login"
          className="mt-6 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-5 text-lg font-semibold text-primary-foreground"
        >
          See my cleans
        </Link>
      </Frame>
    );
  }

  const admin = createSupabaseAdminClient();
  const [tz, orgRes, crewRes] = await Promise.all([
    getOrgTimezone(visit.organization_id),
    admin
      .from("organizations")
      .select("name, logo_url, brand_color, contact_phone" as never)
      .eq("id", visit.organization_id)
      .maybeSingle() as unknown as Promise<{
      data: { name: string; logo_url: string | null; brand_color: string | null; contact_phone: string | null } | null;
    }>,
    // Who is coming. Names only, never contact details.
    admin
      .from("booking_assignees")
      .select("membership:memberships ( id, display_name, profile:profiles ( full_name ) )")
      .eq("booking_id", visit.id) as unknown as Promise<{
      data: Array<{ membership: { id: string; display_name: string | null; profile: { full_name: string | null } | null } | null }> | null;
    }>,
  ]);
  const org = orgRes.data;
  const companyName = org?.name ?? "your cleaning company";
  const crew = Array.from(
    new Set(
      (crewRes.data ?? [])
        .map((r) => (r.membership ? memberDisplayName(r.membership) : null))
        .filter((n): n is string => Boolean(n) && n !== "Unknown")
        // A first name is how a client knows their cleaner.
        .map((n) => n.split(/\s+/)[0]),
    ),
  );

  const when = new Date(visit.scheduled_at);
  const day = when.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = when.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const service = visit.service_type_label ?? humanizeEnum(visit.service_type);
  // Whether they can pick a new time themselves, and the company's notice
  // period, which also decides whether a cancel happens at once.
  const move = await visitMoveState(visit);
  const state = clientBookingActions(visit, Date.now(), move.rules.noticeHours);
  const canAct = state.canNote || state.canSkip;
  const button = brandButtonColors(org?.brand_color);

  const heading =
    visit.status === "cancelled"
      ? "This visit was cancelled"
      : visit.status === "completed"
        ? "This visit is finished"
        : visit.status === "pending"
          ? "Your clean, not yet confirmed"
          : "Your clean";

  return (
    <Frame>
      <div className="flex items-center gap-3">
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- the company's own logo, from its own storage
          <img src={org.logo_url} alt="" className="h-10 w-auto max-w-[9rem] object-contain" />
        ) : null}
        <p className="text-base font-semibold">{companyName}</p>
      </div>

      <h1 className="mt-6 text-balance text-2xl font-bold tracking-tight">{heading}</h1>

      <dl className="mt-4 divide-y divide-border rounded-xl border border-border text-base">
        <Row label="When">
          <span className="font-semibold">{day}</span>
          <span className="block">{time}</span>
        </Row>
        <Row label="What">
          {service}
          {visit.duration_minutes ? (
            <span className="block text-sm text-muted-foreground">About {formatDurationMinutes(visit.duration_minutes)} of work</span>
          ) : null}
        </Row>
        {visit.address ? <Row label="Where">{visit.address}</Row> : null}
        {crew.length > 0 ? <Row label={crew.length === 1 ? "Your cleaner" : "Your cleaners"}>{crew.join(" and ")}</Row> : null}
      </dl>

      {visit.status === "pending" && (
        <p className="mt-4 text-base text-muted-foreground">{companyName} will confirm this visit with you.</p>
      )}

      <div className="mt-6">
        {canAct ? (
          <VisitActions token={token} companyName={companyName} cancelsAtOnce={state.skipAutoApplies} button={button} moveHref={move.allowed ? `/v/${token}/move` : null} />
        ) : (
          // After the client cancels from this page it reloads into this
          // state, so the sentence here is also their confirmation.
          <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-base">
            {visit.status === "cancelled"
              ? `It will not go ahead, and ${companyName} knows. If that isn't what you wanted, call them.`
              : (state.reason ?? "This visit can't be changed here.")}
          </p>
        )}
      </div>

      <div className="mt-8 space-y-3 border-t border-border pt-5 text-base">
        {org?.contact_phone ? (
          <p>
            Rather talk to someone? Call {companyName} at{" "}
            <a href={`tel:${org.contact_phone.replace(/[^\d+]/g, "")}`} className="font-semibold underline underline-offset-4">
              {org.contact_phone}
            </a>
            .
          </p>
        ) : null}
        <p>
          <Link href="/client/login" className="font-medium underline underline-offset-4">
            See all my cleans and invoices
          </Link>
        </p>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] justify-center bg-muted/30 px-4 py-8">
      <main className="h-fit w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</main>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="w-24 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
