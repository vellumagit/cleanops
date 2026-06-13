import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  MapPin,
  Clock as ClockIcon,
  FileText,
  Phone,
  Users,
} from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { memberDisplayName } from "@/lib/member-display";
import {
  SplitShiftTimeline,
  type SplitTimelineSegment,
} from "@/app/app/scheduling/split-shift-timeline";
import { toneForEmployee } from "@/app/app/scheduling/color";
import { JobActionButtons } from "./job-actions";
import { JobPhotos } from "./job-photos";
import { ShiftAcceptance } from "./shift-acceptance";
import { ShiftCancel } from "./shift-cancel";
import { OpenInMaps } from "@/components/open-in-maps";
import { fetchJobPhotos } from "@/lib/job-photos";
import { getOrgTimezone } from "@/lib/org-timezone";
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
  const tz = await getOrgTimezone(membership.organization_id);

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
        series_id,
        client:clients ( name, phone, address )
      `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!booking) notFound();

  // Cancelled bookings shouldn't be openable via a bookmarked URL —
  // otherwise a cleaner could still tap "I'm done" / "On my way" on
  // a job that's been called off.
  if (booking.status === "cancelled") {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-base text-muted-foreground">
        This job was cancelled.
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

  // Is this member an additional crew assignee (via booking_assignees)?
  // Combined with the primary assigned_to check below, this lets the
  // whole crew on a multi-person job see the detail page.
  // Also fetch split segment metadata so we can show the employee their
  // own segment start time and duration instead of the full booking.
  const { data: crewRow } = (await supabase
    .from("booking_assignees" as never)
    .select(
      "id, split_start_offset_minutes, split_duration_minutes, acceptance_status",
    )
    .eq("booking_id" as never, id as never)
    .eq("membership_id" as never, membership.id as never)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
      acceptance_status: string | null;
    } | null;
  };

  const isAssignee =
    booking.assigned_to === membership.id || crewRow !== null;

  // Compute segment-adjusted start time and duration for split employees.
  const effectiveScheduledAt =
    crewRow?.split_start_offset_minutes != null
      ? new Date(
          new Date(booking.scheduled_at).getTime() +
            crewRow.split_start_offset_minutes * 60_000,
        ).toISOString()
      : booking.scheduled_at;

  const effectiveDurationMinutes =
    crewRow?.split_duration_minutes ?? booking.duration_minutes;

  // The cleaner must confirm a pending shift before they can start it.
  // (Legacy bookings with no junction row have crewRow === null and skip
  // acceptance — they're treated as already accepted.)
  const needsAcceptance =
    crewRow?.acceptance_status === "pending" &&
    booking.status !== "completed";

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

  // Per-job address wins (some jobs override it), otherwise fall back to the
  // client's address on file. Bookings created without a snapshotted address
  // (certain recurring series / portal requests) were showing nothing here.
  const displayAddress =
    booking.address ?? booking.client?.address ?? null;

  // Pull every assignee's segment so a split-shift cleaner sees the whole
  // shift laid out — their own window lit, the rest dimmed — instead of
  // just their isolated slot. Only renders when 2+ segments exist.
  const { data: allSegRows } = (await supabase
    .from("booking_assignees" as never)
    .select(
      `membership_id, split_start_offset_minutes, split_duration_minutes,
       membership:memberships ( display_name, profile:profiles ( full_name ) )`,
    )
    .eq("booking_id" as never, booking.id as never)) as unknown as {
    data: Array<{
      membership_id: string;
      split_start_offset_minutes: number | null;
      split_duration_minutes: number | null;
      membership: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };

  const splitRows = (allSegRows ?? [])
    .filter(
      (r) =>
        r.split_start_offset_minutes != null &&
        r.split_duration_minutes != null,
    )
    .sort(
      (a, b) =>
        (a.split_start_offset_minutes ?? 0) -
        (b.split_start_offset_minutes ?? 0),
    );

  const bookingStartMs = new Date(booking.scheduled_at).getTime();
  const splitSegments: SplitTimelineSegment[] =
    splitRows.length >= 2
      ? splitRows.map((r, i) => {
          const offset = r.split_start_offset_minutes ?? 0;
          return {
            key: r.membership_id,
            employeeName: memberDisplayName(r.membership ?? {}),
            startOffsetMinutes: offset,
            durationMinutes: r.split_duration_minutes ?? 0,
            color: toneForEmployee(i),
            startLabel: new Date(
              bookingStartMs + offset * 60_000,
            ).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: tz,
            }),
            durationLabel: formatDurationMinutes(r.split_duration_minutes ?? 0),
            highlight: r.membership_id === membership.id,
          };
        })
      : [];

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
                {formatDateTime(effectiveScheduledAt, tz)}
              </div>
              <div className="text-sm text-muted-foreground">
                Estimated {formatDurationMinutes(effectiveDurationMinutes)}
              </div>
            </div>
          </div>
          {splitSegments.length > 0 && (
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 text-sm font-semibold">
                  Split shift — your window is highlighted
                </div>
                <SplitShiftTimeline segments={splitSegments} />
              </div>
            </div>
          )}
          {displayAddress ? (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-semibold">{displayAddress}</div>
                <OpenInMaps
                  address={displayAddress}
                  className="mt-1 inline-flex items-center rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary active:bg-primary/20"
                >
                  Open in Maps
                </OpenInMaps>
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

      {needsAcceptance ? (
        <ShiftAcceptance bookingId={booking.id} />
      ) : (
        <>
          <JobActionButtons bookingId={booking.id} status={booking.status} />
          {booking.status !== "completed" && (
            <ShiftCancel
              bookingId={booking.id}
              isRecurring={Boolean(booking.series_id)}
            />
          )}
        </>
      )}
    </div>
  );
}
