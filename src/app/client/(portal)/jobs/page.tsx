import { Calendar, MapPin } from "lucide-react";
import { requireClient } from "@/lib/client-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatDateTime,
  formatDurationMinutes,
  humanizeEnum,
} from "@/lib/format";
import {
  StatusBadge,
  bookingStatusTone,
} from "@/components/status-badge";

export const metadata = { title: "My jobs" };

export default async function ClientJobsPage() {
  const client = await requireClient();
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, duration_minutes, status, service_type, address",
    )
    .eq("client_id", client.id)
    .order("scheduled_at", { ascending: false })
    .limit(200);

  // Split into upcoming vs past for scanning. Capture "now" once so
  // both filters agree on the boundary.
  // eslint-disable-next-line react-hooks/purity
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

      <Section title="Upcoming" jobs={upcoming} />
      <Section title="Past" jobs={past} />
    </div>
  );
}

type Job = {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  service_type: string;
  address: string | null;
};

function Section({ title, jobs }: { title: string; jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} jobs.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul className="space-y-2">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {formatDateTime(j.scheduled_at)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {humanizeEnum(j.service_type)} ·{" "}
                  {formatDurationMinutes(j.duration_minutes)}
                </p>
                {j.address && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {j.address}
                  </p>
                )}
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
        ))}
      </ul>
    </section>
  );
}
