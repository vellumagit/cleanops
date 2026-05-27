"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Pencil,
  ExternalLink,
  MapPin,
  Clock,
  User,
  Navigation,
  Users,
  Send,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ScheduleBooking, ScheduleEmployee } from "./data";
import { AssignCrewDialog } from "@/app/app/bookings/assign-crew-dialog";

function formatDateTime(iso: string, tz?: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Read-only quick view of a booking that pops up from the calendar /
 * scheduling grid. The goal is to keep the user in context (they don't
 * lose their calendar position) while still giving them fast access to
 * Edit and the full detail page.
 *
 * Renders from the same ScheduleBooking rows the grid already fetched,
 * so there's no extra round-trip on open — it's instant. For the
 * assignee name we look up the employee in the passed-in employees
 * list; if the booking is unassigned we just say so.
 */
export function BookingQuickView({
  booking,
  employees,
  open,
  onOpenChange,
  tz,
}: {
  booking: ScheduleBooking | null;
  employees: ScheduleEmployee[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tz: string;
}) {
  const [assignOpen, setAssignOpen] = useState(false);

  if (!booking) return null;

  const assignee = booking.assigned_to
    ? employees.find((e) => e.id === booking.assigned_to)
    : null;
  const additionalIds = (booking.all_assignee_ids ?? []).filter(
    (id) => id !== booking.assigned_to,
  );

  // Visible diagnostic: when a booking has multiple assignees but no
  // segment metadata (split_start_offset_minutes / split_duration_minutes
  // are NULL on the booking_assignees rows), we can't render a split
  // breakdown. Surface this to the owner instead of silently falling
  // back to the segment-0 view — that's the failure mode Svitlana
  // hit and it was confusing because the grid placement DOES use the
  // (non-existent) segment data, so she sees mismatched times.
  const allAssigneeCount = (booking.all_assignee_ids ?? []).length;
  const looksMultiCrewButNoSegments =
    allAssigneeCount > 1 && Object.keys(segmentsMap).length === 0;

  // SPLIT SHIFT DETECTION
  // booking.assigneeSegments is { [membershipId]: { start_offset_minutes,
  // duration_minutes } } and is only populated for split-shift bookings.
  // When present we render a per-segment breakdown so the owner sees
  // who's working which window — not just the segment-0 employee.
  const segmentsMap = booking.assigneeSegments ?? {};
  const hasSplits = Object.keys(segmentsMap).length > 0;
  const segmentCount = Object.keys(segmentsMap).length;

  // Diagnostic log — visible in mobile DevTools or `vercel logs`.
  // JSON.stringify so the segments are preserved if you read the log
  // from the console history (the previous version logged a live Object
  // ref that couldn't be expanded post-hoc).
  if (typeof window !== "undefined") {
    console.log(
      "[BookingQuickView v2]",
      booking.id,
      "segments:",
      segmentCount,
      JSON.stringify(segmentsMap),
      "all_assignee_ids:",
      JSON.stringify(booking.all_assignee_ids ?? []),
    );
  }

  // Build an ordered list of segments by start_offset for display.
  const sortedSegments = hasSplits
    ? Object.entries(segmentsMap)
        .map(([membershipId, seg]) => ({
          membershipId,
          start_offset_minutes: seg.start_offset_minutes,
          duration_minutes: seg.duration_minutes,
          employeeName:
            employees.find((e) => e.id === membershipId)?.name ?? "Unknown",
        }))
        .sort((a, b) => a.start_offset_minutes - b.start_offset_minutes)
    : [];

  // Compute each segment's absolute start time for display.
  const bookingStartMs = new Date(booking.scheduled_at).getTime();
  const segmentTimeLabel = (offsetMinutes: number) =>
    new Date(bookingStartMs + offsetMinutes * 60_000).toLocaleTimeString(
      "en-US",
      {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogTitle className="text-base">
              {booking.client_name}
            </DialogTitle>
            <StatusBadge tone={bookingStatusTone(booking.status)}>
              {humanizeEnum(booking.status)}
            </StatusBadge>
          </div>
          {booking.service_type && (
            <p className="text-xs text-muted-foreground">
              {humanizeEnum(booking.service_type)}
              {/* Temporary build marker so we can confirm the latest
                  deploy is loaded on each device. Remove once verified. */}
              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                build 27 may
              </span>
            </p>
          )}
        </DialogHeader>

        <dl className="space-y-3 text-sm">
          <Row icon={<Clock className="h-3.5 w-3.5" />} label="When">
            <span className="tabular-nums">
              {formatDateTime(booking.scheduled_at, tz)}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              · {formatDuration(booking.duration_minutes)}
              {hasSplits && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  Split shift
                </span>
              )}
            </span>
          </Row>

          {hasSplits ? (
            <Row icon={<Users className="h-3.5 w-3.5" />} label="Crew">
              <ul className="space-y-1.5">
                {sortedSegments.map((seg) => (
                  <li
                    key={seg.membershipId}
                    className="flex items-baseline gap-2"
                  >
                    <span className="font-medium">{seg.employeeName}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {segmentTimeLabel(seg.start_offset_minutes)} ·{" "}
                      {formatDuration(seg.duration_minutes)}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
          ) : (
            <Row icon={<User className="h-3.5 w-3.5" />} label="Assigned">
              {assignee ? (
                <span>{assignee.name}</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  Unassigned
                </span>
              )}
            </Row>
          )}

          {looksMultiCrewButNoSegments && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
              ⚠️ This booking has {allAssigneeCount} crew but no split
              segment data was found. Open in editor → toggle splits off
              and back on, then save to rebuild.
            </div>
          )}

          {booking.address && (
            <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Address">
              <span className="whitespace-pre-wrap">{booking.address}</span>
            </Row>
          )}
        </dl>

        <DialogFooter
          showCloseButton
          className="flex-wrap gap-2"
        >
          {booking.address && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Navigation className="h-4 w-4" />
              Maps
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAssignOpen(true)}
          >
            <Users className="h-4 w-4" />
            Assign
          </Button>
          <Link
            href={`/app/bookings/${booking.id}/offer`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Send className="h-4 w-4" />
            Send to bench
          </Link>
          <Link
            href={`/app/bookings/${booking.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="h-4 w-4" />
            Full details
          </Link>
          <Link
            href={`/app/bookings/${booking.id}/edit`}
            className={buttonVariants({ size: "sm" })}
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </DialogFooter>
      </DialogContent>

      {/* Nested dialog for crew assignment. Kept outside the main
          DialogContent so closing Assign doesn't close the quick view
          too. The quick view parent stays open via `open` prop. */}
      <AssignCrewDialog
        bookingId={booking.id}
        employees={employees.map((e) => ({ id: e.id, label: e.name }))}
        initialPrimaryId={booking.assigned_to}
        initialAdditionalIds={additionalIds}
        seriesId={booking.series_id}
        seriesScheduledAt={booking.scheduled_at}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />
    </Dialog>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}
