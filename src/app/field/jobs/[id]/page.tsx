import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin, Clock as ClockIcon, FileText } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { JobActionButtons } from "./job-actions";

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

  // Defence in depth: even though the field UI only links to assigned jobs,
  // employees viewing someone else's job by URL should bounce back.
  if (booking.assigned_to !== membership.id) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        This job isn&apos;t assigned to you.
        <div className="mt-3">
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

  return (
    <div className="space-y-5">
      <Link
        href="/field/jobs"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3 w-3" /> All jobs
      </Link>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {booking.client?.name ?? "—"}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {humanizeEnum(booking.service_type)}
            </p>
          </div>
          <StatusBadge tone={bookingStatusTone(booking.status)}>
            {humanizeEnum(booking.status)}
          </StatusBadge>
        </div>

        <dl className="mt-4 space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-medium">
                {formatDateTime(booking.scheduled_at)}
              </div>
              <div className="text-xs text-muted-foreground">
                Estimated {formatDurationMinutes(booking.duration_minutes)}
              </div>
            </div>
          </div>
          {booking.address ? (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium">{booking.address}</div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    booking.address,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline underline-offset-2"
                >
                  Open in maps
                </a>
              </div>
            </div>
          ) : null}
          {booking.client?.phone ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 inline-block h-4 w-4 shrink-0 text-center text-xs text-muted-foreground">
                ☎
              </span>
              <a
                href={`tel:${booking.client.phone}`}
                className="font-medium text-primary"
              >
                {booking.client.phone}
              </a>
            </div>
          ) : null}
          {booking.notes ? (
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {booking.notes}
              </p>
            </div>
          ) : null}
        </dl>
      </div>

      <JobActionButtons bookingId={booking.id} status={booking.status} />
    </div>
  );
}
