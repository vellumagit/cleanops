import { requireMembership } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FieldHeader } from "@/components/field-shell";
import { formatDateTime, formatDurationMinutes } from "@/lib/format";
import { ClockCard } from "./clock-card";

export const metadata = { title: "Clock" };

function diffMinutes(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

export default async function FieldClockPage() {
  const membership = await requireMembership();
  const supabase = await createSupabaseServerClient();

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [{ data: open }, { data: history }] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        "id, clock_in_at, booking:bookings ( id, client:clients ( name ) )",
      )
      .eq("employee_id", membership.id)
      .is("clock_out_at", null)
      .order("clock_in_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_entries")
      .select(
        "id, clock_in_at, clock_out_at, booking:bookings ( client:clients ( name ) )",
      )
      .eq("employee_id", membership.id)
      .not("clock_out_at", "is", null)
      .gte("clock_in_at", since.toISOString())
      .order("clock_in_at", { ascending: false })
      .limit(20),
  ]);

  const openBookingLabel = open?.booking?.client?.name ?? null;

  return (
    <>
      <FieldHeader
        title="Clock"
        description="Track your shift. Geolocation is captured at clock-in and clock-out."
      />

      <ClockCard
        isClockedIn={Boolean(open)}
        openSinceIso={open?.clock_in_at ?? null}
        openBookingLabel={openBookingLabel}
      />

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Last 7 days
        </h2>
        {!history || history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
            No completed shifts yet this week.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((entry) => {
              const minutes =
                entry.clock_out_at && entry.clock_in_at
                  ? diffMinutes(entry.clock_in_at, entry.clock_out_at)
                  : 0;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {entry.booking?.client?.name ?? "Generic shift"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(entry.clock_in_at)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-medium tabular-nums">
                      {formatDurationMinutes(minutes)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
