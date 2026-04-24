import Link from "next/link";
import { ChevronLeft, CalendarPlus, CheckCircle2, XCircle } from "lucide-react";
import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import { getOrgTimezone } from "@/lib/org-timezone";
import { updateRequestStatusAction } from "./actions";

export const metadata = { title: "Booking requests" };

type RequestRow = {
  id: string;
  service_type: string | null;
  preferred_date: string | null;
  preferred_time_window: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
  client: { id: string; name: string; email: string | null; phone: string | null } | null;
};

function statusTone(status: string): StatusTone {
  if (status === "pending") return "amber";
  if (status === "scheduled") return "green";
  if (status === "declined") return "red";
  return "neutral";
}

export default async function BookingRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const membership = await requireMembership(["owner", "admin", "manager"]);
  const supabase = await createSupabaseServerClient();
  const tz = await getOrgTimezone(membership.organization_id);
  const { filter } = await searchParams;
  const showResolved = filter === "resolved";

  let query = supabase
    .from("booking_requests" as never)
    .select(
      `id, service_type, preferred_date, preferred_time_window, address,
       notes, status, created_at, responded_at,
       client:clients ( id, name, email, phone )`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (showResolved) {
    query = query.in("status" as never, [
      "scheduled",
      "declined",
      "cancelled",
    ] as never);
  } else {
    query = query.eq("status" as never, "pending" as never);
  }

  const { data } = (await query) as unknown as { data: RequestRow[] | null };
  const rows = data ?? [];

  const tabLinkClass = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-background text-foreground shadow-sm border border-border"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <PageShell
      title="Booking requests"
      description="Requests submitted by clients from the portal. Review, reply, and convert to a real booking."
      actions={
        <Link
          href="/app/bookings"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Bookings
        </Link>
      }
    >
      <div className="mb-4 inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <Link
          href="/app/bookings/requests"
          className={tabLinkClass(!showResolved)}
        >
          Pending
        </Link>
        <Link
          href="/app/bookings/requests?filter=resolved"
          className={tabLinkClass(showResolved)}
        >
          Resolved
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium">
            {showResolved
              ? "No resolved requests yet."
              : "No pending requests."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            When a client requests a booking from the portal, it&rsquo;ll show
            up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {r.client?.name ?? "Unknown client"}
                    </span>
                    <StatusBadge tone={statusTone(r.status)}>
                      {humanizeEnum(r.status)}
                    </StatusBadge>
                  </div>
                  {r.service_type && (
                    <p className="mt-1 text-sm text-foreground">
                      {r.service_type}
                    </p>
                  )}
                  <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    {r.preferred_date && (
                      <div>
                        <dt className="inline font-medium">Preferred date: </dt>
                        <dd className="inline">{r.preferred_date}</dd>
                      </div>
                    )}
                    {r.preferred_time_window && (
                      <div>
                        <dt className="inline font-medium">Preferred time: </dt>
                        <dd className="inline">
                          {humanizeEnum(r.preferred_time_window)}
                        </dd>
                      </div>
                    )}
                    {r.address && (
                      <div className="sm:col-span-2">
                        <dt className="inline font-medium">Address: </dt>
                        <dd className="inline">{r.address}</dd>
                      </div>
                    )}
                    {r.client?.email && (
                      <div>
                        <dt className="inline font-medium">Email: </dt>
                        <dd className="inline">
                          <a
                            href={`mailto:${r.client.email}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.client.email}
                          </a>
                        </dd>
                      </div>
                    )}
                    {r.client?.phone && (
                      <div>
                        <dt className="inline font-medium">Phone: </dt>
                        <dd className="inline">
                          <a
                            href={`tel:${r.client.phone.replace(/[^\d+]/g, "")}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.client.phone}
                          </a>
                        </dd>
                      </div>
                    )}
                  </dl>
                  {r.notes && (
                    <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2.5 text-xs text-foreground">
                      {r.notes}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Submitted {formatDateTime(r.created_at, tz)}
                    {r.responded_at
                      ? ` · resolved ${formatDateTime(r.responded_at, tz)}`
                      : ""}
                  </p>
                </div>

                {r.status === "pending" && r.client?.id && (
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row">
                    {/* Quick jump to pre-fill the booking form with this
                        client. The owner still picks package / price / time. */}
                    <Link
                      href={`/app/bookings/new?client_id=${r.client.id}&from_request=${r.id}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Create booking
                    </Link>
                    <form action={updateRequestStatusAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="scheduled" />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel="Saving…"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Mark resolved
                      </SubmitButton>
                    </form>
                    <form action={updateRequestStatusAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="declined" />
                      <SubmitButton
                        variant="outline"
                        size="sm"
                        pendingLabel="Saving…"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Decline
                      </SubmitButton>
                    </form>
                  </div>
                )}

                {showResolved && (
                  <form action={updateRequestStatusAction} className="shrink-0">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="status" value="pending" />
                    <SubmitButton
                      variant="ghost"
                      size="sm"
                      pendingLabel="Reopening…"
                    >
                      Reopen
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
