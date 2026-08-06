import Link from "next/link";
import { Calendar, MapPin, Star } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import { StatusBadge, bookingStatusTone } from "@/components/status-badge";
import { getOrgTimezone } from "@/lib/org-timezone";

export const metadata = { title: "My jobs" };

export default async function ClientJobsPage() {
  const client = await requireClient();
  // The portal HOME one directory up already resolves this for the very
  // same bookings. This list did not, so a client's two screens disagreed.
  const tz = await getOrgTimezone(client.organization_id);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const { data: jobs } = await supabase
    .from("bookings")
    .select(
      // service_type_label — the enum is a category, not what the
      // client bought. Every recurring occurrence otherwise reads "Recurring".
      "id, scheduled_at, duration_minutes, status, service_type, service_type_label, address",
    )
    .eq("client_id", client.id)
    // Same rule as the portal home: an unconfirmed job is not the client's
    // business yet. Without this the full history list rendered a bare amber
    // "Pending" chip via humanizeEnum, which is internal jargon.
    .neq("status", "pending")
    .order("scheduled_at", { ascending: false })
    .limit(200);

  // Fetch review tokens for completed bookings (column not in generated types)
  const completedIds = (jobs ?? [])
    .filter((j) => j.status === "completed")
    .map((j) => j.id);

  const tokenMap = new Map<string, string | null>(); // bookingId → review_token
  if (completedIds.length > 0) {
    const { data: tokenRows } = (await admin
      .from("bookings")
      .select("id, review_token")
      .in("id", completedIds)) as unknown as {
      data: Array<{ id: string; review_token: string | null }> | null;
    };
    for (const row of tokenRows ?? []) {
      tokenMap.set(row.id, row.review_token ?? null);
    }
  }

  // Fetch reviews already submitted by this client so we can show their
  // rating instead of a "Leave a review" link.
  const { data: myReviews } = await supabase
    .from("reviews")
    .select("booking_id, rating")
    .eq("client_id", client.id);

  const reviewedBookingIds = new Map<string, number>(); // bookingId → rating
  for (const r of myReviews ?? []) {
    if (r.booking_id) reviewedBookingIds.set(r.booking_id, r.rating);
  }

  // eslint-disable-next-line react-hooks/purity -- server component: renders once on the server, no hydration to drift
  const nowMs = Date.now();
  const upcoming = (jobs ?? []).filter(
    (j) => new Date(j.scheduled_at).getTime() >= nowMs,
  );
  const past = (jobs ?? []).filter(
    (j) => new Date(j.scheduled_at).getTime() < nowMs,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">My cleaning jobs</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every visit, upcoming or past.
        </p>
      </div>

      <Section
        tz={tz}
        title="Upcoming"
        jobs={upcoming}
        tokenMap={tokenMap}
        reviewedMap={reviewedBookingIds}
      />
      <Section
        tz={tz}
        title="Past"
        jobs={past}
        tokenMap={tokenMap}
        reviewedMap={reviewedBookingIds}
      />
    </div>
  );
}

type Job = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  service_type: string;
  service_type_label: string | null;
  address: string | null;
};

function Section({
  tz,
  title,
  jobs,
  tokenMap,
  reviewedMap,
}: {
  tz: string;
  title: string;
  jobs: Job[];
  tokenMap: Map<string, string | null>;
  reviewedMap: Map<string, number>;
}) {
  if (jobs.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          No {title.toLowerCase()} jobs.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul className="space-y-2">
        {jobs.map((j) => {
          const reviewToken = tokenMap.get(j.id) ?? null;
          const submittedRating = reviewedMap.get(j.id) ?? null;
          const canReview =
            j.status === "completed" && reviewToken && !submittedRating;

          return (
            <li
              key={j.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {formatDateTime(j.scheduled_at, tz)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {j.service_type_label ?? humanizeEnum(j.service_type)} ·{" "}
                    {formatDurationMinutes(j.duration_minutes)}
                  </p>
                  {j.address && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {j.address}
                    </p>
                  )}

                  {/* Review CTA — only for completed jobs */}
                  {submittedRating ? (
                    // Already reviewed — show their stars read-only
                    <div className="mt-2 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3.5 w-3.5 ${
                            s <= submittedRating
                              ? "fill-amber-400 text-amber-400"
                              : "fill-muted text-muted"
                          }`}
                        />
                      ))}
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        Your review
                      </span>
                    </div>
                  ) : canReview ? (
                    <Link
                      href={`/review/${reviewToken}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 transition-opacity hover:underline active:underline active:opacity-70"
                    >
                      <Star className="h-3 w-3" />
                      Leave a review
                    </Link>
                  ) : null}
                </div>

                <StatusBadge
                  tone={bookingStatusTone(
                    j.status as
                      | "pending"
                      | "confirmed"
                      | "en_route"
                      | "in_progress"
                      | "completed"
                      | "cancelled",
                  )}
                >
                  {humanizeEnum(j.status)}
                </StatusBadge>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
