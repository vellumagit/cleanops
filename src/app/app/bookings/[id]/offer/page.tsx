import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { isTwilioEnabled } from "@/lib/twilio";
import { memberDisplayName } from "@/lib/member-display";
import { JobOfferForm } from "./offer-form";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "Offer this shift" };

export default async function NewJobOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const tz = await getOrgTimezone(membership.organization_id);
  const { id: bookingId } = await params;
  const supabase = await createSupabaseServerClient();

  const [
    { data: booking, error: bErr },
    { data: contacts, error: cErr },
    { data: rosterRows, error: mErr },
  ] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, scheduled_at, duration_minutes, service_type, address, total_cents, client:clients ( name )",
      )
      .eq("id", bookingId)
      .maybeSingle(),
    supabase
      .from("freelancer_contacts")
      .select("id, full_name, phone, active")
      .eq("active", true)
      .order("full_name"),
    // The org's own subcontractors — same offer, different deal: they're
    // paid from clocked hours at their usual rate, never the flat amount.
    supabase
      .from("memberships")
      .select(
        "id, role, status, engagement, display_name, contact_phone, profile:profiles ( full_name, phone )",
      )
      .eq("organization_id", membership.organization_id)
      .eq("status", "active")
      .eq("engagement" as never, "subcontractor" as never),
  ]);

  if (bErr) throw bErr;
  if (!booking) notFound();
  if (cErr) throw cErr;
  if (mErr) throw mErr;

  type RosterRow = {
    id: string;
    display_name: string | null;
    contact_phone: string | null;
    profile: { full_name: string | null; phone: string | null } | null;
  };
  const members = ((rosterRows ?? []) as unknown as RosterRow[])
    .map((m) => ({
      id: m.id,
      name: memberDisplayName(m),
      phone: m.contact_phone ?? m.profile?.phone ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Nobody to offer to at all — send the admin to the on-call page to add
  // someone before trying again.
  if ((!contacts || contacts.length === 0) && members.length === 0) {
    redirect("/app/freelancers");
  }

  return (
    <PageShell
      title="Offer this shift"
      description="Text your own subcontractors and the on-call pool. First to claim gets it."
      actions={
        <Link
          href={`/app/bookings/${booking.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to booking
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-border bg-card p-6">
          <JobOfferForm
            tz={tz}
            bookingId={booking.id}
            contacts={(contacts ?? []).map((c) => ({
              id: c.id,
              full_name: c.full_name,
              phone: c.phone,
            }))}
            members={members}
            booking={{
              scheduled_at: booking.scheduled_at,
              duration_minutes: booking.duration_minutes,
              service_type: booking.service_type,
              address: booking.address,
            }}
          />
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Shift summary</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Service</dt>
                <dd className="font-medium text-foreground">
                  {humanizeEnum(booking.service_type)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">When</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(booking.scheduled_at, tz)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="font-medium text-foreground">
                  {formatDurationMinutes(booking.duration_minutes)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="truncate font-medium text-foreground">
                  {booking.client?.name ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
            <p className="sollos-label mb-2">Who gets paid what</p>
            <p>
              <span className="font-medium text-foreground">
                Your subcontractors
              </span>{" "}
              are paid their usual rate from clocked hours — claiming just
              assigns them the job.
            </p>
            <p className="mt-2">
              <span className="font-medium text-foreground">
                On-call cleaners
              </span>{" "}
              earn the flat amount you set here, once the job completes.
            </p>
          </div>

          {!isTwilioEnabled() && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-semibold">Twilio is disabled.</p>
              <p className="mt-1">
                No SMS will be sent. Dispatch rows will be marked{" "}
                <code className="font-mono text-[11px]">skipped_disabled</code>{" "}
                and you can preview the claim flow by clicking the generated
                links on the offer detail page.
              </p>
            </div>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
