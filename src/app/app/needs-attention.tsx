import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveBilledBookings } from "@/lib/billed-bookings";
import { formatDate } from "@/lib/format";

/**
 * The dashboard's "needs a look" card — the app saying out loud what it
 * already knows, before it becomes a support text.
 *
 * Born from a real day of those texts: Svitlana booked property jobs with
 * no price, completed them, generated invoices, and got $0 drafts — then
 * voided one and tried again. Every step was reasonable; the system knew
 * the whole time that the jobs had no price and said nothing anywhere she
 * was looking. Each bucket here is one of those silences, with the count,
 * the specific items, and the click that fixes them.
 *
 * Rules of the card:
 *   - Silent when healthy. No buckets, no card, no nag.
 *   - Money-shaped only, and bounded windows (45 days back, 14 forward) so
 *     ancient history doesn't haunt the dashboard forever.
 *   - Consolidated-billing clients' unbilled work is NOT flagged — their
 *     cron sweeps it on the cycle date; flagging it would cry wolf.
 *   - It can never take the dashboard down: any error renders nothing.
 */

const LOOKBACK_DAYS = 45;
const LOOKAHEAD_DAYS = 14;
const MAX_SHOWN = 4;

type JobRow = {
  id: string;
  scheduled_at: string;
  client: { name: string } | null;
};

export async function NeedsAttention({ tz }: { tz: string }) {
  try {
    const supabase = await createSupabaseServerClient();
    const nowIso = new Date().toISOString();
    const backIso = new Date(
      Date.now() - LOOKBACK_DAYS * 86_400_000,
    ).toISOString();
    const aheadIso = new Date(
      Date.now() + LOOKAHEAD_DAYS * 86_400_000,
    ).toISOString();

    const [unpricedDone, unpricedUpcoming, pricedDone, zeroDrafts] =
      await Promise.all([
        supabase
          .from("bookings")
          .select("id, scheduled_at, client:clients ( name )")
          .eq("status", "completed")
          .gte("scheduled_at", backIso)
          .or("total_cents.is.null,total_cents.eq.0")
          .order("scheduled_at", { ascending: false })
          .limit(50) as unknown as Promise<{ data: JobRow[] | null }>,
        supabase
          .from("bookings")
          .select("id, scheduled_at, client:clients ( name )")
          .in("status", ["pending", "confirmed"])
          .gte("scheduled_at", nowIso)
          .lte("scheduled_at", aheadIso)
          .or("total_cents.is.null,total_cents.eq.0")
          .order("scheduled_at", { ascending: true })
          .limit(50) as unknown as Promise<{ data: JobRow[] | null }>,
        supabase
          .from("bookings")
          .select(
            "id, scheduled_at, client_id, client:clients ( name, billing_cadence )",
          )
          .eq("status", "completed")
          .gte("scheduled_at", backIso)
          .gt("total_cents", 0)
          .limit(200) as unknown as Promise<{
          data: Array<{
            id: string;
            scheduled_at: string;
            client_id: string | null;
            client: { name: string; billing_cadence: string | null } | null;
          }> | null;
        }>,
        supabase
          .from("invoices")
          .select("id, number, client:clients ( name )")
          .eq("status", "draft")
          .eq("amount_cents", 0)
          .is("voided_at", null)
          .limit(25) as unknown as Promise<{
          data: Array<{
            id: string;
            number: string | null;
            client: { name: string } | null;
          }> | null;
        }>,
      ]);

    // Unbilled finished work — on-demand clients only. Anchored/legacy
    // monthly and biweekly clients get swept by the billing cron; their
    // "unbilled" state between cycles is the system working as designed.
    const sweepable = (pricedDone.data ?? []).filter(
      (b) =>
        b.client_id &&
        (b.client?.billing_cadence ?? "on_demand") === "on_demand",
    );
    let unbilledByClient: Array<{
      clientId: string;
      name: string;
      count: number;
    }> = [];
    if (sweepable.length > 0) {
      const billed = await resolveBilledBookings(
        supabase,
        sweepable.map((b) => b.id),
      );
      const grouped = new Map<string, { name: string; count: number }>();
      for (const b of sweepable) {
        if (billed.has(b.id)) continue;
        const g = grouped.get(b.client_id as string) ?? {
          name: b.client?.name ?? "—",
          count: 0,
        };
        g.count += 1;
        grouped.set(b.client_id as string, g);
      }
      unbilledByClient = [...grouped.entries()]
        .map(([clientId, g]) => ({ clientId, ...g }))
        .sort((a, b) => b.count - a.count);
    }

    const doneRows = unpricedDone.data ?? [];
    const upcomingRows = unpricedUpcoming.data ?? [];
    const draftRows = zeroDrafts.data ?? [];

    if (
      doneRows.length === 0 &&
      upcomingRows.length === 0 &&
      unbilledByClient.length === 0 &&
      draftRows.length === 0
    ) {
      return null;
    }

    const jobLine = (b: JobRow) => (
      <li key={b.id}>
        <Link
          href={`/app/bookings/${b.id}`}
          className="text-foreground underline-offset-2 hover:underline"
        >
          {formatDate(b.scheduled_at, tz)} · {b.client?.name ?? "—"}
        </Link>
      </li>
    );

    return (
      <div className="mb-6 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Needs a look
          </h2>
        </div>

        <div className="mt-3 grid gap-4 text-xs text-amber-900/90 dark:text-amber-200/90 sm:grid-cols-2">
          {doneRows.length > 0 && (
            <div>
              <p className="font-medium">
                {doneRows.length} finished{" "}
                {doneRows.length === 1 ? "job has" : "jobs have"} no price
              </p>
              <p className="mt-0.5 text-amber-900/70 dark:text-amber-200/70">
                Invoices and percentage pay read it — a $0 job bills $0.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {doneRows.slice(0, MAX_SHOWN).map(jobLine)}
                {doneRows.length > MAX_SHOWN && (
                  <li className="italic">
                    and {doneRows.length - MAX_SHOWN} more…
                  </li>
                )}
              </ul>
            </div>
          )}

          {upcomingRows.length > 0 && (
            <div>
              <p className="font-medium">
                {upcomingRows.length} upcoming{" "}
                {upcomingRows.length === 1 ? "job has" : "jobs have"} no price
              </p>
              <p className="mt-0.5 text-amber-900/70 dark:text-amber-200/70">
                Set it now and the invoice is ready the day the job is done.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {upcomingRows.slice(0, MAX_SHOWN).map(jobLine)}
                {upcomingRows.length > MAX_SHOWN && (
                  <li className="italic">
                    and {upcomingRows.length - MAX_SHOWN} more…
                  </li>
                )}
              </ul>
            </div>
          )}

          {unbilledByClient.length > 0 && (
            <div>
              <p className="font-medium">Finished work not invoiced yet</p>
              <ul className="mt-1.5 space-y-0.5">
                {unbilledByClient.slice(0, MAX_SHOWN).map((c) => (
                  <li key={c.clientId}>
                    <Link
                      href={`/app/invoices/new?client_id=${c.clientId}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {c.name} — {c.count} {c.count === 1 ? "job" : "jobs"}
                    </Link>
                  </li>
                ))}
                {unbilledByClient.length > MAX_SHOWN && (
                  <li className="italic">
                    and {unbilledByClient.length - MAX_SHOWN} more clients…
                  </li>
                )}
              </ul>
            </div>
          )}

          {draftRows.length > 0 && (
            <div>
              <p className="font-medium">
                {draftRows.length} empty $0 draft{" "}
                {draftRows.length === 1 ? "invoice" : "invoices"}
              </p>
              <p className="mt-0.5 text-amber-900/70 dark:text-amber-200/70">
                Fill in the amount, or delete the draft if it shouldn&rsquo;t
                exist.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {draftRows.slice(0, MAX_SHOWN).map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/app/invoices/${d.id}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {d.number ?? "Draft"} · {d.client?.name ?? "—"}
                    </Link>
                  </li>
                ))}
                {draftRows.length > MAX_SHOWN && (
                  <li className="italic">
                    and {draftRows.length - MAX_SHOWN} more…
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  } catch (err) {
    // An advisory card must never cost the dashboard. Log and vanish.
    console.error("[needs-attention] failed to render:", err);
    return null;
  }
}
