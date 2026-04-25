import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Send } from "lucide-react";
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
import { GenerateInvoiceButton } from "./generate-invoice-button";
import { JobPhotos } from "@/app/field/jobs/[id]/job-photos";
import {
  BookingChecklist,
  type BookingChecklistItem,
} from "@/app/app/checklists/booking-checklist";
import { AttachTemplateButton } from "@/app/app/checklists/attach-template-button";
import { AssignCrewButton } from "@/app/app/bookings/assign-crew-button";

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
        id, scheduled_at, duration_minutes, service_type, status,
        total_cents, hourly_rate_cents, address, notes, created_at,
        estimate_id,
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
            id, status, pay_cents, created_at, filled_at,
            dispatches:job_offer_dispatches ( id )
          `,
        )
        .eq("booking_id", id)
        .order("created_at", { ascending: false })
    : { data: null };

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

  // Active employees in the org — feeds the Assign-crew popup so the
  // owner can change the primary or add more crew without leaving this
  // page. RLS scopes memberships to the current org.
  const { data: employeesData } = canEdit
    ? ((await supabase
        .from("memberships")
        .select("id, display_name, profile:profiles ( full_name )")
        .eq("status", "active")
        .in("role", ["employee", "admin", "owner"])
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
  const assignableEmployees = (employeesData ?? []).map((m) => ({
    id: m.id,
    label: memberDisplayName(m) ?? "Unnamed",
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
      title={humanizeEnum(booking.service_type)}
      description={formatDateTime(booking.scheduled_at, tz)}
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            {showGenerateInvoice && (
              <GenerateInvoiceButton bookingId={booking.id} />
            )}
            {assignableEmployees.length > 0 && (
              <AssignCrewButton
                bookingId={booking.id}
                employees={assignableEmployees}
                initialPrimaryId={booking.assigned?.id ?? null}
                initialAdditionalIds={additionalAssigneeIds}
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
                <p className="sollos-label">Freelancer offers</p>
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
