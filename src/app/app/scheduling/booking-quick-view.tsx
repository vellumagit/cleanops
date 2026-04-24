"use client";

import Link from "next/link";
import {
  Pencil,
  ExternalLink,
  MapPin,
  Clock,
  User,
  Navigation,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ScheduleBooking, ScheduleEmployee } from "./data";

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
  if (!booking) return null;

  const assignee = booking.assigned_to
    ? employees.find((e) => e.id === booking.assigned_to)
    : null;

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
            </span>
          </Row>

          <Row icon={<User className="h-3.5 w-3.5" />} label="Assigned">
            {assignee ? (
              <span>{assignee.name}</span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                Unassigned
              </span>
            )}
          </Row>

          {booking.address && (
            <Row icon={<MapPin className="h-3.5 w-3.5" />} label="Address">
              <span className="whitespace-pre-wrap">{booking.address}</span>
            </Row>
          )}
        </dl>

        <DialogFooter showCloseButton>
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
