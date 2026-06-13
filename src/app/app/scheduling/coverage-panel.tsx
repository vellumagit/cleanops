import { AlertTriangle, CalendarX } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { memberDisplayName } from "@/lib/member-display";
import { formatDateTime } from "@/lib/format";
import { ResolveRequestButton } from "./resolve-request-button";

type RequestRow = {
  id: string;
  reason: string | null;
  created_at: string;
  membership: {
    display_name: string | null;
    profile: { full_name: string | null } | null;
  } | null;
  booking: {
    scheduled_at: string;
    client: { name: string | null } | null;
  } | null;
};

/**
 * "Needs coverage" panel for the top of the Scheduling page. Shows open
 * recurring-stop requests (cleaners asking off a standing client) plus a
 * count of upcoming shifts with no cleaner assigned (left behind by
 * declines/cancels). Renders nothing when everything's covered.
 */
export async function CoveragePanel({
  organizationId,
  tz,
}: {
  organizationId: string;
  tz: string;
}) {
  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();

  const [{ data: requests }, { count: unfilled }] = await Promise.all([
    supabase
      .from("shift_change_requests" as never)
      .select(
        "id, reason, created_at, membership:memberships ( display_name, profile:profiles ( full_name ) ), booking:bookings ( scheduled_at, client:clients ( name ) )",
      )
      .eq("organization_id" as never, organizationId as never)
      .eq("status" as never, "open" as never)
      .order("created_at" as never, { ascending: false } as never)
      .limit(20) as unknown as { data: RequestRow[] | null },
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("scheduled_at", nowIso)
      .in("status", ["pending", "confirmed"])
      .is("assigned_to", null) as unknown as { count: number | null },
  ]);

  const reqs = requests ?? [];
  const unfilledCount = unfilled ?? 0;
  if (reqs.length === 0 && unfilledCount === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/25">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Needs coverage
        </h2>
      </div>

      {unfilledCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-200/80">
          <CalendarX className="h-4 w-4 shrink-0" />
          <span>
            <strong>{unfilledCount}</strong> upcoming shift
            {unfilledCount === 1 ? "" : "s"} {unfilledCount === 1 ? "has" : "have"}{" "}
            no cleaner assigned — they appear unassigned on the board below.
          </span>
        </p>
      )}

      {reqs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {reqs.map((r) => {
            const who = r.membership
              ? memberDisplayName(r.membership)
              : "A cleaner";
            const client = r.booking?.client?.name ?? "a recurring client";
            return (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-card px-3 py-2.5 dark:border-amber-900/40"
              >
                <div className="min-w-0 text-sm">
                  <div className="font-medium text-foreground">
                    {who} is requesting off{" "}
                    <span className="font-semibold">{client}</span> (recurring)
                  </div>
                  {r.reason && (
                    <div className="mt-0.5 text-muted-foreground">
                      &ldquo;{r.reason}&rdquo;
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Requested {formatDateTime(r.created_at, tz)}
                    {r.booking?.scheduled_at
                      ? ` · cancelled visit on ${formatDateTime(r.booking.scheduled_at, tz)}`
                      : ""}
                  </div>
                </div>
                <ResolveRequestButton requestId={r.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
