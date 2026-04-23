import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  MapPin,
  Clock as ClockIcon,
  FileText,
  Phone,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { JobActionButtons } from "./job-actions";
import { JobPhotos } from "./job-photos";
import { fetchJobPhotos } from "@/lib/job-photos";
import {
  BookingChecklist,
  type BookingChecklistItem,
} from "@/app/app/checklists/booking-checklist";

export const metadata = { title: "Job detail" };

export default async function FieldJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const membership = await requireMembership();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      `
        id,
        scheduled_at,
        duration_minutes,
        status,
        service_type,
        address,
        notes,
        assigned_to,
        client:clients ( name, phone )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!booking) notFound();

  // Is this member an additional crew assignee (via booking_assignees)?
  // Combined with the primary assigned_to check below, this lets the
  // whole crew on a multi-person job see the detail page.
  const { data: crewRow } = (await supabase
    .from("booking_assignees" as never)
    .select("id")
    .eq("booking_id" as never, id as never)
    .eq("membership_id" as never, membership.id as never)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  const isAssignee =
    booking.assigned_to === membership.id || crewRow !== null;

  // Defence in depth: even though the field UI only links to assigned jobs,
  // employees viewing someone else's job by URL should bounce back.
  if (!isAssignee) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-base text-muted-foreground">
        This job isn&apos;t assigned to you.
        <div className="mt-4">
          <Link
            href="/field/jobs"
            className="text-primary underline underline-offset-2"
          >
            Back to my jobs
          </Link>
        </div>
      </div>
    );
  }

  // Fetch photos only after the assignment check passes.
  const photos = await fetchJobPhotos(booking.id);

  // Checklist items (if any).
  const { data: checklistItems } = (await supabase
    .from("booking_checklist_items" as never)
    .select("id, ordinal, title, phase, is_required, checked_at")
    .eq("booking_id" as never, booking.id as never)
    .order("ordinal" as never, {
      ascending: true,
    } as never)) as unknown as {
    data: BookingChecklistItem[] | null;
  };

  return (
    <div className="space-y-5">
      <Link
        href="/field/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground active:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> All jobs
      </Link>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">
              {booking.client?.name ?? "—"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {humanizeEnum(booking.service_type)}
            </p>
          </div>
          <StatusBadge tone={bookingStatusTone(booking.status)}>
            {humanizeEnum(booking.status)}
          </StatusBadge>
        </div>

        <dl className="mt-5 space-y-4 text-[15px]">
          <div className="flex items-start gap-3">
            <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-semibold">
                {formatDateTime(booking.scheduled_at)}
              </div>
              <div className="text-sm text-muted-foreground">
                Estimated {formatDurationMinutes(booking.duration_minutes)}
              </div>
            </div>
          </div>
          {booking.address ? (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-semibold">{booking.address}</div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    booking.address,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary active:bg-primary/20"
                >
                  Open in Maps
                </a>
              </div>
            </div>
          ) : null}
          {booking.client?.phone ? (
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <a
                href={`tel:${booking.client.phone}`}
                className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary active:bg-primary/20"
              >
                {booking.client.phone}
              </a>
            </div>
          ) : null}
          {booking.notes ? (
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {booking.notes}
              </p>
            </div>
          ) : null}
        </dl>
      </div>

      <JobPhotos
        bookingId={booking.id}
        photos={photos}
        canManage={true}
      />

      {checklistItems && checklistItems.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">Checklist</h2>
          <BookingChecklist
            bookingId={booking.id}
            items={checklistItems}
            canRemove={false}
          />
        </div>
      )}

      <JobActionButtons bookingId={booking.id} status={booking.status} />
    </div>
  );
}
