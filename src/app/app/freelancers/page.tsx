import Link from "next/link";
import { Plus, Send } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { FreelancersTable, type FreelancerRow } from "./freelancers-table";
import { UnassignedBookings, type UnassignedBookingRow } from "./unassigned-bookings";
import { isTwilioEnabled } from "@/lib/twilio";
import { getSubcontractorPayables } from "@/lib/subcontractor-payables";
import { getOrgCurrency } from "@/lib/org-currency";
import { formatCurrencyCents } from "@/lib/format";
import { Wallet } from "lucide-react";

export const metadata = { title: "Subcontractor bench" };

export default async function FreelancersPage() {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const canEdit = true;
  const supabase = await createSupabaseServerClient();

  const [{ data: contacts, error: contactsErr }, { data: bookings, error: bookingsErr }] =
    await Promise.all([
      supabase
        .from("freelancer_contacts")
        .select(
          "id, full_name, phone, email, active, last_offered_at, last_accepted_at",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("bookings")
        .select(
          `id, scheduled_at, duration_minutes, service_type, status, total_cents,
           client:clients ( name )`,
        )
        .is("assigned_to", null)
        .in("status", ["pending", "confirmed"])
        .order("scheduled_at", { ascending: true })
        .limit(50),
    ]);

  if (contactsErr) throw contactsErr;
  if (bookingsErr) throw bookingsErr;

  const rows: FreelancerRow[] = contacts ?? [];
  const twilioOn = isTwilioEnabled();

  // Pay is a view of these same people, so it belongs in this section rather
  // than as its own sidebar entry. Surfacing the outstanding total here means
  // the link is worth following (or obviously isn't).
  const [{ rows: payRows, totalOutstandingCents }, currency] = await Promise.all([
    getSubcontractorPayables(membership.organization_id),
    getOrgCurrency(membership.organization_id),
  ]);
  const owedCount = payRows.filter((r) => r.outstandingCents > 0).length;

  // A freelancer who claims an offer CANNOT be written to bookings.assigned_to
  // — they aren't a membership, and that column is a FK to memberships. So
  // `.is("assigned_to", null)` above still matches jobs the bench has already
  // covered, and this panel kept asking you to fill a shift Big Bob had
  // already accepted, while the bookings list correctly showed it as his.
  // resolveBookingCoverage is the shared rule: assignee OR crew OR claim.
  const { resolveBookingCoverage } = await import("@/lib/booking-coverage");
  const coverage = await resolveBookingCoverage((bookings ?? []).map((b) => b.id));

  const unassignedRows: UnassignedBookingRow[] = (bookings ?? [])
    .filter((b) => !coverage.get(b.id)?.staffed)
    .map((b) => ({
      id: b.id,
      scheduled_at: b.scheduled_at,
      duration_minutes: b.duration_minutes,
      service_type: b.service_type,
      status: b.status as "pending" | "confirmed",
      total_cents: b.total_cents,
      client_name: b.client?.name ?? "—",
    }));

  return (
    <PageShell
      title="Subcontractor bench"
      description="Off-platform cleaners you can text when you need emergency coverage."
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/app/freelancers/offers"
            className={buttonVariants({ variant: "outline" })}
          >
            <Send className="h-4 w-4" />
            Offers
          </Link>
          <Link
            href="/app/freelancers/new"
            className={buttonVariants({ variant: "default" })}
          >
            <Plus className="h-4 w-4" />
            New subcontractor
          </Link>
        </div>
      }
    >
      {!twilioOn && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">Twilio is disabled.</span> Offers
          can still be created — each dispatch row is marked{" "}
          <code className="font-mono text-[11px]">skipped_disabled</code> and
          you can test the full claim flow by clicking the preview links on
          the offer detail page. Flip <code>TWILIO_ENABLED=true</code> when
          you&rsquo;re ready to start sending real SMS.
        </div>
      )}

      {/* ── Pay: the subsection, not a separate area of the app ── */}
      <Link
        href="/app/freelancers/payables"
        className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Subcontractor pay</p>
            <p className="text-xs text-muted-foreground">
              {totalOutstandingCents > 0
                ? `Owed to ${owedCount} subcontractor${owedCount === 1 ? "" : "s"} for completed jobs`
                : "Nothing outstanding — every claimed job is paid up"}
            </p>
          </div>
        </div>
        <span
          className={
            totalOutstandingCents > 0
              ? "shrink-0 text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400"
              : "shrink-0 text-lg font-bold tabular-nums text-muted-foreground"
          }
        >
          {formatCurrencyCents(totalOutstandingCents, currency)}
        </span>
      </Link>

      {/* Unassigned bookings ready to deploy */}
      {unassignedRows.length > 0 && (
        <div className="mb-6">
          <UnassignedBookings rows={unassignedRows} />
        </div>
      )}

      <FreelancersTable rows={rows} canEdit={canEdit} />
    </PageShell>
  );
}
