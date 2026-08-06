import { cn } from "@/lib/utils";

/**
 * Placeholder blocks for route-level loading states.
 *
 * Deliberately not the full-screen SollosLoader: that is a boot splash, and
 * throwing it up on every tab change makes a fast navigation feel like a cold
 * start. Within an app shell the right thing is a shape that matches what is
 * about to arrive, so the layout does not jump when it does.
 *
 * `animate-pulse` is Tailwind's own, and it already respects
 * prefers-reduced-motion via the motion-safe defaults in globals.css.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
    />
  );
}

/** A card-shaped placeholder — matches the portal's list rows. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-3", i === lines - 1 ? "w-1/2" : "w-3/4")}
          />
        ))}
      </div>
    </div>
  );
}

/** A stack of card placeholders, for a list route. */
export function SkeletonList({
  count = 3,
  lines = 2,
}: {
  count?: number;
  lines?: number;
}) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}
