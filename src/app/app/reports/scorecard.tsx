import Link from "next/link";
import { type CurrencyCode, formatCurrencyCents, formatDurationMinutes } from "@/lib/format";
import { overrunPct, type CleanerRow } from "./profitability-data";

/**
 * Cleaner scorecard: one row per person who clocked time in the window.
 *
 * Revenue per hour is the price of the jobs they worked, attributed by their
 * share of the clocked minutes, over their hours — so a two-person job
 * credits each cleaner with the part they actually did. It's a productivity
 * signal, not a commission: wages come from rates, never from this number.
 */
export function ScorecardSection({
  rows,
  currency,
}: {
  rows: CleanerRow[];
  currency: CurrencyCode;
}) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Cleaners</h2>
        <span className="text-xs text-muted-foreground">
          Everyone who clocked time in this window, most hours first
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Revenue per hour is the price of the jobs they worked, credited by
        their share of the time on site. Pay is what those hours cost at
        their wage.
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No clocked shifts in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Person</th>
                <th className="py-1.5 pr-3 text-right font-medium">Hours</th>
                <th className="py-1.5 pr-3 text-right font-medium">Jobs</th>
                <th className="py-1.5 pr-3 text-right font-medium">vs quote</th>
                <th className="py-1.5 pr-3 text-right font-medium">Pay</th>
                <th className="py-1.5 pr-3 text-right font-medium">Rev / hr</th>
                <th className="py-1.5 pr-3 text-right font-medium">Rating</th>
                <th className="py-1.5 pr-3 text-right font-medium">Bonuses</th>
                <th className="py-1.5 text-right font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const o = overrunPct(r.quoted_minutes, r.minutes);
                const revPerHour =
                  r.minutes > 0
                    ? Math.round((r.revenue_cents * 60) / r.minutes)
                    : null;
                const flags: string[] = [];
                if (r.no_clock_in_flags > 0)
                  flags.push(
                    `${r.no_clock_in_flags} no clock-in`,
                  );
                if (r.needs_review > 0)
                  flags.push(`${r.needs_review} needs review`);
                return (
                  <tr key={r.employee_id} className="border-b border-border/60">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/app/employees/${r.employee_id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.engagement === "subcontractor" && (
                        <span className="ml-2 text-muted-foreground">contractor</span>
                      )}
                      {r.status !== "active" && (
                        <span className="ml-2 text-muted-foreground">{r.status}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {formatDurationMinutes(r.minutes)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.jobs}</td>
                    <td
                      className={`py-1.5 pr-3 text-right tabular-nums ${
                        o != null && o > 10
                          ? "text-amber-600 dark:text-amber-400"
                          : o != null && o < -10
                            ? "text-emerald-600 dark:text-emerald-400"
                            : ""
                      }`}
                      title="Hours worked against the share of quoted time on those jobs"
                    >
                      {o == null ? "—" : o > 0 ? `+${o}%` : o < 0 ? `${o}%` : "0%"}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatCurrencyCents(r.labor_cents, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {revPerHour == null
                        ? "—"
                        : formatCurrencyCents(revPerHour, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.avg_rating == null
                        ? "—"
                        : `${Number(r.avg_rating).toFixed(1)} (${r.reviews})`}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {r.bonus_cents > 0
                        ? formatCurrencyCents(r.bonus_cents, currency)
                        : "—"}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        flags.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                      }`}
                    >
                      {flags.length > 0 ? flags.join(", ") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
