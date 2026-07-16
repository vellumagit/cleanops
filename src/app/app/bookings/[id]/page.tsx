import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Copy, Pencil, Send } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  StatusBadge,
  bookingStatusTone,
  formatBookingStatus,
  type StatusTone,
} from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { fetchJobPhotos } from "@/lib/job-photos";
import { memberDisplayName } from "@/lib/member-display";
import { getOrgTimezone } from "@/lib/org-timezone";
import { getFlaggedCrewIds } from "@/lib/crew-accommodations";
import { GenerateInvoiceButton } from "./generate-invoice-button";
import { MakeRecurringButton } from "./make-recurring-button";
import { JobPhotos } from "@/app/field/jobs/[id]/job-photos";
import {
  BookingChecklist,
  type BookingChecklistItem,
} from "@/app/app/checklists/booking-checklist";
import { AttachTemplateButton } from "@/app/app/checklists/attach-template-button";
import { AssignCrewButton } from "@/app/app/bookings/assign-crew-button";
import {
  duplicateBookingAction,
  markBookingCompleteAction,
} from "@/app/app/bookings/actions";

export const metadata = { title: "Booking" };

type BookingStatus =
  | "pending"
  | "confirmed"
  | "en_route"
  | "in_progress"
  | "completed"
  | "cancelled";

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

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership();
  const canEdit = membership.role === "owner" || membership.role === "admin";
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);

  const { data: booking, error } = (await supabase
    .from("bookings")
    .select(
      `
        id, scheduled_at, duration_minutes, service_type, service_type_label, status,
        total_cents, hourly_rate_cents, address, notes, created_at,
        estimate_id, series_id,
        client:clients ( id, name, phone, email, address ),
        package:packages ( id, name ),
        assigned:memberships!bookings_assigned_to_fkey (
          id, display_name, profile:profiles ( full_name )
        )
      `,
    )
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      service_type: string;
      service_type_label: string | null;
      status: string;
      total_cents: number;
      hourly_rate_cents: number | null;
      address: string | null;
      notes: string | null;
      created_at: string;
      estimate_id: string | null;
      client: { id: string; name: string; phone: string | null; email: string | null; address: string | null } | null;
      package: { id: string; name: string } | null;
      assigned: {
        id: string;
        display_name: string | null;
        profile: { full_name: string } | null;
      } | null;
    } | null;
    error: { message: string } | null;
  };

  if (error) throw error;
  if (!booking) notFound();

  // Offer history for this booking — only visible to admins, RLS will
  // silently return zero rows for employees (and they shouldn't reach here
  // anyway).
  const { data: offers } = canEdit
    ? await supabase
        .from("job_offers")
        .select(
          `
            id, status, pay_cents, created_at, filled_at, filled_contact_id,
            dispatches:job_offer_dispatches ( id )
          `,
        )
        .eq("booking_id", id)
        .order("created_at", { ascending: false })
    : { data: null };

  // Resolve names for filled offers so the booking shows WHO is covering it
  // (freelancers aren't members, so they can't fill the assigned-crew slot).
  const filledContactIds = ((offers ?? []) as Array<{ filled_contact_id?: string | null }>)
    .map((o) => o.filled_contact_id)
    .filter((v): v is string => Boolean(v));
  const filledNames = new Map<string, string>();
  if (filledContactIds.length > 0) {
    const { data: fc } = (await supabase
      .from("freelancer_contacts")
      .select("id, full_name")
      .in("id", filledContactIds)) as unknown as {
      data: Array<{ id: string; full_name: string | null }> | null;
    };
    for (const c of fc ?? []) {
      if (c.full_name) filledNames.set(c.id, c.full_name);
    }
  }

  // Names of freelancers covering this booking (filled offers). A booking with
  // no assigned member but a claimed offer is staffed by a freelancer — surface
  // that instead of a misleading "Unassigned".
  const coveringFreelancerNames = (
    (offers ?? []) as Array<{ status: string; filled_contact_id?: string | null }>
  )
    .filter((o) => o.status === "filled" && o.filled_contact_id)
    .map((o) => filledNames.get(o.filled_contact_id as string))
    .filter((v): v is string => Boolean(v));

  const bookingStatus = booking.status as BookingStatus;

  // Does this completed booking already have an invoice? If not AND
  // the status is completed, surface a "Generate invoice" escape
  // hatch so the owner doesn't have to pick through Vercel logs when
  // the auto-run didn't fire (migration not applied, automation
  // toggle off, etc.).
  const { data: existingInvoice } = canEdit
    ? await supabase
        .from("invoices")
        .select("id")
        .eq("booking_id", id)
        .limit(1)
        .maybeSingle()
    : { data: null };
  const showGenerateInvoice =
    canEdit &&
    bookingStatus === "completed" &&
    !existingInvoice;

  // Photos are read-visible to any org member (RLS enforces that). Upload
  // + delete UI only shows for owner/admin/manager on the admin side.
  const photos = await fetchJobPhotos(booking.id);
  const canManagePhotos = ["owner", "admin", "manager"].includes(
    membership.role,
  );

  // Additional crew (non-primary) on this booking. Only surface when
  // there's more than one assignee so solo jobs look unchanged.
  const { data: extraAssignees } = (await supabase
    .from("booking_assignees" as never)
    .select("membership_id, membership:memberships ( id, display_name, profile:profiles ( full_name ) )")
    .eq("booking_id" as never, booking.id as never)
    .eq("is_primary" as never, false as never)) as unknown as {
    data: Array<{
      membership_id: string;
      membership: {
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };
  const additionalCrewNames = (extraAssignees ?? [])
    .map((r) =>
      r.membership?.display_name?.trim() ||
      r.membership?.profile?.full_name?.trim() ||
      null,
    )
    .filter((n): n is string => !!n);
  const additionalAssigneeIds = (extraAssignees ?? []).map(
    (r) => r.membership_id,
  );

  // Crew acceptance — who has confirmed vs is still pending. A cleaner who
  // declines is removed from booking_assignees entirely (and the managers get
  // a decline email), so the list only ever shows accepted/pending.
  const { data: crewRows } = (await supabase
    .from("booking_assignees" as never)
    .select(
      "membership_id, is_primary, acceptance_status, responded_at, membership:memberships ( display_name, profile:profiles ( full_name ) )",
    )
    .eq("booking_id" as never, booking.id as never)
    .order("is_primary" as never, { ascending: false } as never)) as unknown as {
    data: Array<{
      is_primary: boolean;
      acceptance_status: string | null;
      responded_at: string | null;
      membership: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };
  const crew = (crewRows ?? []).map((r, i) => ({
    key: `${i}`,
    name:
      r.membership?.display_name?.trim() ||
      r.membership?.profile?.full_name?.trim() ||
      "Crew member",
    isPrimary: r.is_primary,
    status: r.acceptance_status ?? "pending",
    respondedAt: r.responded_at,
  }));

  // Active employees in the org — feeds the Assign-crew popup so the
  // owner can change the primary or add more crew without leaving this
  // page. RLS scopes memberships to the current org.
  const { data: employeesData } = canEdit
    ? ((await supabase
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name )")
        .eq("status", "active")
        .in("role", ["employee", "admin", "owner", "manager"])
        .order("display_name", {
          ascending: true,
        })) as unknown as {
        data: Array<{
          id: string;
          display_name: string | null;
          profile: { full_name: string | null } | null;
        }> | null;
      })
    : { data: null };
  const flaggedCrew = await getFlaggedCrewIds(
    (employeesData ?? []).map((m) => m.id),
  );
  const assignableEmployees = (employeesData ?? []).map((m) => ({
    id: m.id,
    label: memberDisplayName(m) ?? "Unnamed",
    hasAccommodations: flaggedCrew.has(m.id),
  }));

  // Checklist items attached to this booking + available templates for
  // the attach dropdown.
  const [{ data: checklistItems }, { data: templates }] = await Promise.all([
    supabase
      .from("booking_checklist_items" as never)
      .select("id, ordinal, title, phase, is_required, checked_at")
      .eq("booking_id" as never, booking.id as never)
      .order("ordinal" as never, {
        ascending: true,
      } as never) as unknown as Promise<{
      data: BookingChecklistItem[] | null;
    }>,
    supabase
      .from("checklist_templates" as never)
      .select("id, name")
      .eq("is_active" as never, true as never)
      .order("name" as never, {
        ascending: true,
      } as never) as unknown as Promise<{
      data: Array<{ id: string; name: string }> | null;
    }>,
  ]);

  return (
    <PageShell
      title={booking.service_type_label ?? humanizeEnum(booking.service_type)}
      description={formatDateTime(booking.scheduled_at, tz)}
      actions={
        canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {showGenerateInvoice && (
              <GenerateInvoiceButton bookingId={booking.id} />
            )}
            {bookingStatus !== "completed" && bookingStatus !== "cancelled" && (
              <form action={markBookingCompleteAction.bind(null, booking.id)}>
                <button
                  type="submit"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark complete
                </button>
              </form>
            )}
            <form action={duplicateBookingAction.bind(null, booking.id)}>
              <button
                type="submit"
                className={buttonVariants({ variant: "outline" })}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </button>
            </form>
            {!(booking as { series_id?: string | null }).series_id &&
              bookingStatus !== "cancelled" && (
                <MakeRecurringButton bookingId={booking.id} />
              )}
            {assignableEmployees.length > 0 && (
              <AssignCrewButton
                bookingId={booking.id}
                employees={assignableEmployees}
                initialPrimaryId={booking.assigned?.id ?? null}
                initialAdditionalIds={additionalAssigneeIds}
                seriesId={(booking as { series_id?: string | null }).series_id}
                seriesScheduledAt={booking.scheduled_at}
                variant="outline"
                label={booking.assigned ? "Change crew" : "Assign crew"}
              />
            )}
            <Link
              href={`/app/bookings/${booking.id}/offer`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Send className="h-4 w-4" />
              Send to bench
            </Link>
            <Link
              href={`/app/bookings/${booking.id}/edit`}
              className={buttonVariants({ variant: "default" })}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </div>
        ) : null
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {/* Header card */}
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="sollos-label">Client</p>
                <h2 className="mt-1 text-lg font-semibold">
                  {booking.client?.name ?? "—"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {booking.address ?? booking.client?.address ?? "No address"}
                </p>
              </div>
              <StatusBadge tone={bookingStatusTone(bookingStatus)}>
                {formatBookingStatus(bookingStatus)}
              </StatusBadge>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Scheduled</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {formatDateTime(booking.scheduled_at, tz)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Duration</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {formatDurationMinutes(booking.duration_minutes)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
                  {formatCurrencyCents(booking.total_cents)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Assigned</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {booking.assigned ? (
                    memberDisplayName(booking.assigned)
                  ) : coveringFreelancerNames.length > 0 ? (
                    <span>
                      {coveringFreelancerNames.join(", ")}{" "}
                      <span className="font-normal text-muted-foreground">
                        (subcontractor)
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                  {additionalCrewNames.length > 0 && (
                    <span className="font-normal text-muted-foreground">
                      {" + "}
                      {additionalCrewNames.join(", ")}
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            {crew.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Crew response
                </p>
                <ul className="mt-2 space-y-1.5">
                  {crew.map((c) => {
                    const accepted = c.status === "accepted";
                    return (
                      <li
                        key={c.key}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="font-medium text-foreground">
                          {c.name}
                          {c.isPrimary && (
                            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                              lead
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              accepted
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            }`}
                          >
                            {accepted ? "Accepted" : "Awaiting response"}
                          </span>
                          {accepted && c.respondedAt && (
                            <span className="text-[10px] text-muted-foreground">
                              {formatDateTime(c.respondedAt, tz)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {booking.package?.name && (
              <p className="mt-4 text-xs text-muted-foreground">
                Package: {booking.package.name}
              </p>
            )}

            {booking.notes && (
              <div className="mt-5 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                <p className="sollos-label mb-1">Notes</p>
                {booking.notes}
              </div>
            )}
          </div>

          {/* Job photos */}
          <JobPhotos
            bookingId={booking.id}
            photos={photos}
            canManage={canManagePhotos}
          />

          {/* Checklist */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Checklist</h2>
            </div>
            {canEdit && (
              <div className="mb-4">
                <AttachTemplateButton
                  bookingId={booking.id}
                  templates={templates ?? []}
                />
              </div>
            )}
            {checklistItems && checklistItems.length > 0 ? (
              <BookingChecklist
                bookingId={booking.id}
                items={checklistItems}
                canRemove={canEdit}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                No checklist attached yet.
                {canEdit
                  ? " Pick a template above to apply one."
                  : ""}
              </p>
            )}
          </div>

          {/* Offer history */}
          {canEdit && (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-6 py-3">
                <p className="sollos-label">Subcontractor offers</p>
                <Link
                  href={`/app/bookings/${booking.id}/offer`}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  New offer
                </Link>
              </div>
              {!offers || offers.length === 0 ? (
                <div className="px-6 py-10 text-center text-xs text-muted-foreground">
                  No offers yet. Use{" "}
                  <span className="font-medium text-foreground">
                    Send to bench
                  </span>{" "}
                  above to broadcast this shift.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {offers.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                    >
                      <div>
                        <Link
                          href={`/app/freelancers/offers/${o.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {formatCurrencyCents(o.pay_cents)} ·{" "}
                          {o.dispatches?.length ?? 0} dispatches
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(o.created_at, tz)}
                        </p>
                        {o.status === "filled" &&
                          (o as { filled_contact_id?: string | null })
                            .filled_contact_id &&
                          filledNames.get(
                            (o as { filled_contact_id: string })
                              .filled_contact_id,
                          ) && (
                            <p className="mt-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              Covered by{" "}
                              {filledNames.get(
                                (o as { filled_contact_id: string })
                                  .filled_contact_id,
                              )}
                            </p>
                          )}
                      </div>
                      <StatusBadge tone={offerTone(o.status as OfferStatus)}>
                        {humanizeEnum(o.status)}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Client contact</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Phone</dt>
                <dd className="font-medium text-foreground">
                  {booking.client?.phone ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium text-foreground">
                  {booking.client?.email ?? "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <p className="sollos-label">Meta</p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="font-medium text-foreground">
                  {formatDateTime(booking.created_at, tz)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Hourly rate</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {formatCurrencyCents(booking.hourly_rate_cents)}
                </dd>
              </div>
              {booking.estimate_id && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">From estimate</dt>
                  <dd>
                    <Link
                      href={`/app/estimates/${booking.estimate_id}/edit`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      View estimate
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
