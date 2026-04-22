import { PageShell } from "@/components/page-shell";

/**
 * Reports-page skeleton. The real page runs five parallel queries — each
 * capped but still scanning up to 5,000 rows — which can take several
 * seconds on a well-populated org. Without this, users saw a blank page
 * with no indication anything was happening.
 *
 * The skeleton mirrors the layout: KPI cards on top, a monthly-revenue
 * block, and two side-by-side panels for service mix + top clients.
 */
export default function ReportsLoading() {
  return (
    <PageShell
      title="Reports"
      description="Loading your numbers…"
    >
      {/* Date range placeholder */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="h-[62px] w-36 animate-pulse rounded-md bg-muted" />
        <div className="h-[62px] w-36 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Revenue by month */}
      <div className="mt-6 rounded-lg border border-border bg-card p-5">
        <div className="mb-4 h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-14 animate-pulse rounded bg-muted" />
              <div
                className="h-6 animate-pulse rounded-md bg-muted"
                style={{ width: `${40 + i * 15}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Two-column */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, col) => (
          <div
            key={col}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="mb-4 h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                  <div
                    className="h-5 animate-pulse rounded-md bg-muted"
                    style={{ width: `${30 + i * 18}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom stat row */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-7 w-10 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </PageShell>
  );
}
