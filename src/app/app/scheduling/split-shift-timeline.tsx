import { cn } from "@/lib/utils";

/**
 * One segment of a split shift, pre-shaped by the caller. Times/durations
 * arrive as preformatted label strings so this component stays a pure
 * presentational renderer that works in both server and client trees
 * (the field-app job page is a server component; the scheduler quick-view
 * is a client component).
 */
export type SplitTimelineSegment = {
  /** Stable React key — typically the membership_id. */
  key: string;
  employeeName: string;
  /** Minutes from the booking start. Used only for ordering / sizing. */
  startOffsetMinutes: number;
  /** Drives the segment's proportional height in the block. */
  durationMinutes: number;
  /** Hex accent for this assignee, e.g. "#0ea5e9". Matched to the
   *  scheduler lane color so the block reads consistently with the grid. */
  color: string;
  /** Preformatted segment start, e.g. "9:00 AM". */
  startLabel: string;
  /** Preformatted duration, e.g. "4h". */
  durationLabel: string;
  /** Field app: the viewer's own window. When any segment sets this, the
   *  others dim so the cleaner's slot pops. Omit everywhere in the owner
   *  view, where every segment renders at full strength. */
  highlight?: boolean;
};

/**
 * The "master shift" canvas: one contiguous block laid out top-to-bottom
 * across the full booking span, each segment sized to its duration and
 * tinted in its assignee's lane color, with a dashed seam + handoff marker
 * at every boundary. This is the per-booking view of a split shift — it
 * renders truthfully only where one booking owns the whole column (the
 * quick-view popup and the field-app job page), NOT in the per-employee
 * grids where segments live in separate lanes.
 */
export function SplitShiftTimeline({
  segments,
  className,
}: {
  /** Already sorted ascending by startOffsetMinutes. */
  segments: SplitTimelineSegment[];
  className?: string;
}) {
  if (segments.length === 0) return null;

  const anyHighlight = segments.some((s) => s.highlight);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border",
        className,
      )}
      // Floor keeps short tail segments tall enough to fit their label;
      // grows with segment count so a 3-way split doesn't cramp.
      style={{ minHeight: Math.max(112, segments.length * 52) }}
    >
      {segments.map((seg, i) => {
        const dim = anyHighlight && !seg.highlight;
        return (
          <div
            key={seg.key}
            className={cn(
              "relative flex min-h-0 flex-col justify-center px-3 py-2",
              i > 0 && "border-t border-dashed border-border/80",
              dim && "opacity-45",
            )}
            style={{
              flexGrow: seg.durationMinutes,
              flexBasis: 0,
              borderLeft: `4px solid ${seg.color}`,
              // 8% tint normally, 15% for the highlighted (viewer's) segment.
              backgroundColor: `${seg.color}${seg.highlight ? "26" : "14"}`,
            }}
          >
            {/* Handoff marker centered on the seam — makes the boundary
                read as "one cleaner hands off to the next", not just a
                divider between two unrelated rows. */}
            {i > 0 && (
              <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                {seg.startLabel} handoff
              </span>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: seg.color }}
                />
                {seg.employeeName}
                {seg.highlight && (
                  <span className="rounded bg-foreground px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-background">
                    You
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {seg.startLabel} · {seg.durationLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
