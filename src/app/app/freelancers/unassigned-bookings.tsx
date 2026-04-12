"use client";

import Link from "next/link";
import { AlertTriangle, Users, Clock, MapPin } from "lucide-react";
import { StatusBadge, bookingStatusTone, formatBookingStatus } from "@/components/status-badge";
import {
  formatCurrencyCents,
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";

export type UnassignedBookingRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  service_type: string;
  status: "pending" | "confirmed";
  total_cents: number;
  client_name: string;
};

export function UnassignedBookings({ rows }: { rows: UnassignedBookingRow[] }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 border-b border-amber-500/20 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <h3 className="text-sm font-semibold text-foreground">
          Unassigned jobs ({rows.length})
        </h3>
        <p className="text-xs text-muted-foreground ml-1">
          — send to your bench for coverage
        </p>
      </div>

      <div className="divide-y divide-amber-500/10">
        {rows.map((r) => {
          const isUrgent =
            new Date(r.scheduled_at).getTime() - Date.now() < 24 * 60 * 60 * 1000;

          return (
            <div
              key={r.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              {/* Job info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {r.client_name}
                  </span>
                  <StatusBadge tone={bookingStatusTone(r.status)}>
                    {formatBookingStatus(r.status)}
                  </StatusBadge>
                  {isUrgent && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
                      <Clock className="h-2.5 w-2.5" />
                      Urgent
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {formatDateTime(r.scheduled_at)}
                  </span>
                  <span>{formatDurationMinutes(r.duration_minutes)}</span>
                  <span>{humanizeEnum(r.service_type)}</span>
                  <span className="font-medium text-foreground">
                    {formatCurrencyCents(r.total_cents)}
                  </span>
                </div>
              </div>

              {/* Action */}
              <Link
                href={`/app/bookings/${r.id}/offer`}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors shrink-0"
              >
                <Users className="h-3.5 w-3.5" />
                Send to bench
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
