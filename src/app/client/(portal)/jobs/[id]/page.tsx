import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, MapPin, User, FileText } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrgTimezone } from "@/lib/org-timezone";
import { formatDate, formatDateTime, formatDurationMinutes, humanizeEnum } from "@/lib/format";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { clientBookingActions } from "@/lib/client-job-requests";
import { ClientJobActions } from "./job-actions";

export const metadata = { title: "Your visit" };

/**
 * One visit, from the client's side.
 *
 * The portal had a jobs LIST and nothing behind it, so a client could see that
 * a clean was coming and had no way to say anything about it — every "can you
 * skip the bathroom" was a phone call to the owner. This is the screen that
 * takes those calls.
 */
export default async function ClientJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(client.organization_id);

  // RLS (clients_read_own_bookings) already fences this to the signed-in
  // client; the client_id filter makes the intent explicit rather than
  // relying on a policy elsewhere staying correct.
  const { data: booking } = (await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, duration_minutes, status, service_type, service_type_label, address, notes, assigned_to, archived_at",
    )
    .eq("id", id)
    .eq("client_id", client.id)
    .maybeSingle()) as unknown as {
    data: {
      id: string;
      scheduled_at: string;
      duration_minutes: number;
      status:
        | "pending"
        | "confirmed"
        | "en_route"
        | "in_progress"
        | "completed"
        | "cancelled";
      service_type: string;
      service_type_label: string | null;
      address: string | null;
      notes: string | null;
      assigned_to: string | null;
      archived_at: string | null;
    } | null;
  };

  if (!booking) notFound();

  const admin = createSupabaseAdminClient();

  // Who is coming. Read past RLS because a client has no read on memberships,
  // and only the display name is used — never contact details.
  const { data: crew } = (await admin
    .from("booking_assignees")
    .select("membership:memberships ( display_name )")
    .eq("booking_id", booking.id)) as unknown as {
    data: Array<{ membership: { display_name: string | null } | null }> | null;
  };
  const crewNames = (crew ?? [])
    .map((r) => r.membership?.display_name)
    .filter((n): n is string => Boolean(n));

  // What this client has already said about this visit, so the page can show
  // "you asked us to…" rather than letting them wonder if it went through.
  const { data: saidRaw } = (await admin
    .from("client_job_requests" as never)
    .select("id, kind, body, status, auto_applied, created_at")
    .eq("booking_id", booking.id)
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })) as unknown as {
    data: Array<{
      id: string;
      kind: string;
      body: string | null;
      status: string;
      auto_applied: boolean;
      created_at: string;
    }> | null;
  };
  const said = saidRaw ?? [];

  const state = clientBookingActions(booking);
  const service = booking.service_type_label ?? humanizeEnum(booking.service_type);

  return (
    <div className="space-y-5">
      <Link
        href="/client/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> All visits
      </Link>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{service}</h1>
          </div>
          <StatusBadge tone={bookingStatusTone(booking.status)}>
            {humanizeEnum(booking.status)}
          </StatusBadge>
        </div>

        <dl className="mt-4 space-y-3.5 text-[15px]">
          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="font-semibold">
                {formatDateTime(booking.scheduled_at, tz)}
              </div>
              <div className="text-sm text-muted-foreground">
                About {formatDurationMinutes(booking.duration_minutes)}
              </div>
            </div>
          </div>

          {booking.address && (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 font-semibold">{booking.address}</div>
            </div>
          )}

          {crewNames.length > 0 && (
            <div className="flex items-start gap-3">
              <User className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-semibold">{crewNames.join(", ")}</div>
                <div className="text-sm text-muted-foreground">
                  {crewNames.length === 1 ? "Your cleaner" : "Your cleaners"}
                </div>
              </div>
            </div>
          )}
        </dl>
      </div>

      <ClientJobActions
        bookingId={booking.id}
        canNote={state.canNote}
        canSkip={state.canSkip}
        skipAutoApplies={state.skipAutoApplies}
        reason={state.reason}
      />

      {said.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-muted-foreground" />
            What you&rsquo;ve told us
          </h2>
          <ul className="mt-3 space-y-3">
            {said.map((r) => (
              <li key={r.id} className="text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {r.kind === "job_note" ? "Note" : "Skip request"}
                  </span>
                  <span>{formatDate(r.created_at, tz)}</span>
                  {r.kind === "skip_occurrence" && (
                    <span
                      className={
                        r.status === "resolved"
                          ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                          : "rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                      }
                    >
                      {r.status === "resolved"
                        ? r.auto_applied
                          ? "Cancelled"
                          : "Sorted"
                        : "Waiting on the office"}
                    </span>
                  )}
                </div>
                {r.body && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {r.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
