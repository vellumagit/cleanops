import Link from "next/link";
import { type CurrencyCode, formatCurrencyCents, formatDate, formatDurationMinutes } from "@/lib/format";
import {
  marginPct,
  overrunPct,
  type JobProfitability,
} from "./profitability-data";

/**
 * Job profitability: revenue on completed jobs minus the wages clocked on
 * them, per client and per service, plus the jobs that hurt most.
 *
 * Only completed bookings count as jobs, and only closed time entries count
 * as labor, so a job in progress never shows a fake margin. A job with no
 * clocked time shows its full price as margin — that is honest (no wage was
 * recorded) but the "jobs with time" figure says how much to trust it.
 */
export function ProfitabilitySection({
  report,
  currency,
  orgTz,
}: {
  report: JobProfitability;
  currency: CurrencyCode;
  orgTz: string;
}) {
  const t = report.totals;
  const pct = marginPct(t.revenue_cents, t.margin_cents);
  const over = overrunPct(t.quoted_minutes, t.worked_minutes);
  const coverage =
    t.jobs > 0 ? Math.round((t.jobs_with_time / t.jobs) * 100) : null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Job profitability</h2>
        <span className="text-xs text-muted-foreground">
          Completed jobs in this window, priced at the booking, costed at the
          wages clocked on them
        </span>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Labor is the same cents payroll pays: each shift&apos;s minutes at the
        wage it was worked at. Tips are out on both sides.
      </p>

      {t.jobs === 0 ? (
        <p className="text-xs text-muted-foreground">
          No completed jobs in this window.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Job revenue"
              value={formatCurrencyCents(t.revenue_cents, currency)}
            />
            <Stat
              label="Labor"
              value={formatCurrencyCents(t.labor_cents, currency)}
              tone="amber"
            />
            <Stat
              label="Margin"
              value={formatCurrencyCents(t.margin_cents, currency)}
              tone={t.margin_cents >= 0 ? "green" : "red"}
              sub={pct == null ? undefined : `${pct}% of revenue`}
            />
            <Stat
              label="Worked vs quoted"
              value={`${formatDurationMinutes(t.worked_minutes)} / ${formatDurationMinutes(t.quoted_minutes)}`}
              tone={over != null && over > 10 ? "amber" : "neutral"}
              sub={
                over == null
                  ? undefined
                  : over > 0
                    ? `${over}% over quote`
                    : over < 0
                      ? `${Math.abs(over)}% under quote`
                      : "on quote"
              }
            />
            <Stat
              label="Jobs with time"
              value={`${t.jobs_with_time} of ${t.jobs}`}
              tone={coverage != null && coverage < 80 ? "amber" : "neutral"}
              sub={
                coverage != null && coverage < 100
                  ? "unclocked jobs show full price as margin"
                  : undefined
              }
            />
            <Stat
              label="Labor off the job"
              value={formatCurrencyCents(t.unassigned_labor_cents, currency)}
              sub={
                t.unassigned_minutes > 0
                  ? `${formatDurationMinutes(t.unassigned_minutes)} not tied to a booking`
                  : "every shift was on a booking"
              }
            />
          </div>

          {t.contractor_bills_cents > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Contractor bills dated in this window add{" "}
              <span className="font-mono tabular-nums">
                {formatCurrencyCents(t.contractor_bills_cents, currency)}
              </span>{" "}
              of cost that no single job carries.
            </p>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <GroupTable
              title="By client"
              hint="Best margin first. A client low on this list with many jobs is the one to re-price."
              rows={report.by_client.map((r) => ({
                key: r.client_id,
                label: r.client_name,
                href: `/app/clients/${r.client_id}`,
                ...r,
              }))}
              currency={currency}
            />
            <GroupTable
              title="By service"
              hint="Which kinds of work pay and which run long."
              rows={report.by_service.map((r) => ({
                key: r.service,
                label: r.service,
                ...r,
              }))}
              currency={currency}
            />
          </div>

          {report.worst_jobs.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-1 text-sm font-semibold">
                Jobs that hurt the most
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Thinnest margin first, then the biggest overrun. Only jobs
                with clocked time are listed.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5 pr-3 font-medium">Job</th>
                      <th className="py-1.5 pr-3 font-medium">Service</th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        Quoted
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        Worked
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        Price
                      </th>
                      <th className="py-1.5 pr-3 text-right font-medium">
                        Labor
                      </th>
                      <th className="py-1.5 text-right font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.worst_jobs.map((j) => {
                      const jo = overrunPct(j.quoted_minutes, j.worked_minutes);
                      return (
                        <tr key={j.id} className="border-b border-border/60">
                          <td className="py-1.5 pr-3">
                            <Link
                              href={`/app/bookings/${j.id}`}
                              className="font-medium hover:underline"
                            >
                              {j.client_name}
                            </Link>
                            <span className="ml-2 text-muted-foreground">
                              {formatDate(j.scheduled_at, orgTz)}
                              {j.crew > 1 ? ` · ${j.crew} cleaners` : ""}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 capitalize">{j.service}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatDurationMinutes(j.quoted_minutes)}
                          </td>
                          <td
                            className={`py-1.5 pr-3 text-right tabular-nums ${
                              jo != null && jo > 10
                                ? "text-amber-600 dark:text-amber-400"
                                : ""
                            }`}
                          >
                            {formatDurationMinutes(j.worked_minutes)}
                            {jo != null && jo > 0 ? ` (+${jo}%)` : ""}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {formatCurrencyCents(j.revenue_cents, currency)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {formatCurrencyCents(j.labor_cents, currency)}
                          </td>
                          <td
                            className={`py-1.5 text-right font-mono tabular-nums ${
                              j.margin_cents < 0
                                ? "text-red-600 dark:text-red-400"
                                : ""
                            }`}
                          >
                            {formatCurrencyCents(j.margin_cents, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type GroupRow = {
  key: string;
  label: string;
  href?: string;
  jobs: number;
  revenue_cents: number;
  labor_cents: number;
  margin_cents: number;
  quoted_minutes: number;
  worked_minutes: number;
};

const GROUP_ROW_LIMIT = 12;

function GroupTable({
  title,
  hint,
  rows,
  currency,
}: {
  title: string;
  hint: string;
  rows: GroupRow[];
  currency: CurrencyCode;
}) {
  const shown = rows.slice(0, GROUP_ROW_LIMIT);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing to show.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{title.replace("By ", "")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">Jobs</th>
                <th className="py-1.5 pr-3 text-right font-medium">Revenue</th>
                <th className="py-1.5 pr-3 text-right font-medium">Labor</th>
                <th className="py-1.5 pr-3 text-right font-medium">Margin</th>
                <th className="py-1.5 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const p = marginPct(r.revenue_cents, r.margin_cents);
                const o = overrunPct(r.quoted_minutes, r.worked_minutes);
                return (
                  <tr key={r.key} className="border-b border-border/60">
                    <td className="max-w-[12rem] truncate py-1.5 pr-3 capitalize">
                      {r.href ? (
                        <Link href={r.href} className="hover:underline" title={r.label}>
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.jobs}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatCurrencyCents(r.revenue_cents, currency)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {formatCurrencyCents(r.labor_cents, currency)}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right font-mono tabular-nums ${
                        r.margin_cents < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                      title={p == null ? undefined : `${p}% of revenue`}
                    >
                      {formatCurrencyCents(r.margin_cents, currency)}
                      {p != null && (
                        <span className="ml-1 text-muted-foreground">{p}%</span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        o != null && o > 10 ? "text-amber-600 dark:text-amber-400" : ""
                      }`}
                      title="Worked / quoted"
                    >
                      {formatDurationMinutes(r.worked_minutes)}
                      <span className="text-muted-foreground">
                        {" "}
                        / {formatDurationMinutes(r.quoted_minutes)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing {shown.length} of {rows.length}. The CSV export has every
              row.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red" | "neutral";
}) {
  const valClass =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "red"
          ? "text-red-600 dark:text-red-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-base font-bold tabular-nums ${valClass}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}
