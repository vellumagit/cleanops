import { PageShell } from "@/components/page-shell";

/**
 * Per-section loading skeleton. Before these, only /app (full-screen
 * loader) and /app/reports had loading states — every other click gave
 * zero feedback until the server finished, which read as "Sollos is
 * slow" even when the wait was one round-trip. The section title paints
 * instantly so the user knows the click landed and where they're going.
 */
export function SectionLoading({ title }: { title: string }) {
  return (
    <PageShell title={title} description="Loading…">
      <div className="space-y-2" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-64 animate-pulse rounded-md bg-muted" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-md bg-muted"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
