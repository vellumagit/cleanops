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
  // and only the person's NAME is used — never contact details. The profile
  // join matters: display_name is the office-typed label for shadow members,
  // and NULL for anyone who signed up themselves — which was every real
  // cleaner, so "who's coming" silently vanished from the one page a client
  // checks before letting someone into their house.
  const { data: crew } = (await admin
    .from("booking_assignees")
    .select(
      "membership:memberships ( id, display_name, profile:profiles ( full_name ) )",
    )
    .eq("booking_id", booking.id)) as unknown as {
    data: Array<{
      membership: {
        id: string;
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    }> | null;
  };
  const { memberDisplayName } = await import("@/lib/member-display");
  let crewNames = Array.from(
    new Set(
      (crew ?? [])
        .map((r) => (r.membership ? memberDisplayName(r.membership) : null))
        .filter((n): n is string => Boolean(n) && n !== "Unknown"),
    ),
  );
  // Assigned but no crew rows (legacy bookings predate the invariant that a
  // primary assignee always has one) — resolve the primary directly.
  if (crewNames.length === 0 && booking.assigned_to) {
    const { data: primary } = (await admin
      .from("memberships")
      .select("display_name, profile:profiles ( full_name )")
      .eq("id", booking.assigned_to)
      .maybeSingle()) as unknown as {
      data: {
        display_name: string | null;
        profile: { full_name: string | null } | null;
      } | null;
    };
    const name = primary ? memberDisplayName(primary) : null;
    if (name && name !== "Unknown") crewNames = [name];
  }

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

  // Google Calendar template link — UTC basic timestamps; Google localizes
  // on display, so the client sees their own wall-clock time.
  const gcalStamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const gcalStart = new Date(booking.scheduled_at);
  const gcalEnd = new Date(
    gcalStart.getTime() + (booking.duration_minutes ?? 120) * 60_000,
  );
  const googleCalendarUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(`${service} — ${client.organization_name}`)}` +
    `&dates=${gcalStamp(gcalStart)}/${gcalStamp(gcalEnd)}` +
    (booking.address
      ? `&location=${encodeURIComponent(booking.address)}`
      : "");

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
              {/* "I forgot the cleaner is coming" — the visit can live in the
                  client's own calendar. Google gets a template link; the .ics
                  covers Apple and Outlook natively. Only for visits that are
                  still happening. */}
              {booking.status !== "cancelled" && (
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <a
                    href={googleCalendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Add to Google Calendar
                  </a>
                  <a
                    href={`/api/client-calendar/${booking.id}`}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Apple / Outlook (.ics)
                  </a>
                </div>
              )}
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
