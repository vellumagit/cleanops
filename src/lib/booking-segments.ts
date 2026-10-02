/**
 * Resolve each crew segment on a booking to an explicit window.
 *
 * One booking can put several people on the job at different times. Until
 * 2026-10-02 the only way to express that was "Split shift", which laid
 * segments strictly end-to-end: each one started exactly where the previous
 * finished, so a crew whose hours OVERLAP could not be recorded at all. On a
 * 16-hour three-person job that left the booking with no segment data, which
 * in turn disabled the guard in field/jobs/crew-completion.ts — one cleaner
 * tapping Complete would have ended the job for all three.
 *
 * Segments now carry their own `start_offset_minutes`, so windows can overlap,
 * sit end-to-end, or leave a gap. A hand-off is just the case where they
 * happen not to overlap — one shape, not two features.
 *
 * BACKWARD COMPATIBILITY matters here: ~20 live bookings and 47 assignee rows
 * were written by the old editor and carry no offset. A segment without one
 * falls back to the cumulative sum of the durations before it, which is
 * exactly what the old code computed — so those rows keep their meaning with
 * no data migration.
 */
export type SegmentInput = {
  assigned_to?: string | null;
  duration_minutes?: number | null;
  /** Minutes after the booking's own start. Absent on pre-2026-10 rows. */
  start_offset_minutes?: number | null;
};

export type ResolvedSegment = {
  assigned_to: string | null;
  start_offset_minutes: number;
  duration_minutes: number;
  /** Position in the submitted array, preserved for split_index. */
  index: number;
};

/**
 * Resolve every segment, in submitted order. Segments with no assignee are
 * kept (as null) so the cumulative fallback stays aligned with what the old
 * code did — it advanced its running offset past unassigned rows too.
 */
export function resolveSegmentWindows(
  segments: SegmentInput[],
): ResolvedSegment[] {
  let cumulative = 0;
  return segments.map((seg, index) => {
    const duration = Math.max(0, Number(seg.duration_minutes) || 0);
    const explicit =
      seg.start_offset_minutes == null
        ? null
        : Math.max(0, Number(seg.start_offset_minutes) || 0);
    const start = explicit ?? cumulative;
    cumulative += duration;
    return {
      assigned_to: seg.assigned_to || null,
      start_offset_minutes: start,
      duration_minutes: duration,
      index,
    };
  });
}

/**
 * Do any two assigned windows overlap in time?
 *
 * Drives wording rather than validation — overlapping is legitimate (a crew
 * working together) and so is a gap (someone comes back later). The scheduler
 * uses this to say "with Olha" instead of "then Olha", which would be wrong
 * for people on site at the same time.
 */
export function segmentsOverlap(segments: ResolvedSegment[]): boolean {
  const live = segments
    .filter((s) => s.assigned_to && s.duration_minutes > 0)
    .sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);
  for (let i = 1; i < live.length; i++) {
    const prev = live[i - 1];
    const cur = live[i];
    if (cur.start_offset_minutes < prev.start_offset_minutes + prev.duration_minutes) {
      return true;
    }
  }
  return false;
}

/**
 * "2:30 PM – 10:30 PM" for one cleaner's window, from the booking form's
 * datetime-local value plus that segment's offset and length.
 *
 * An offset in hours and minutes is what gets SAVED, but it is not what an
 * owner thinks in — they know Olha arrives at four. Showing the real clock
 * time is what makes overlapping windows checkable at a glance.
 *
 * No Date and no toLocale* on purpose. `scheduledAtLocal` is a wall-clock
 * string the owner typed ("2026-10-02T14:30") and every number here is an
 * offset from it, so this is plain minute arithmetic on that clock face — no
 * timezone is involved and none should be. Routing it through Date would make
 * the output depend on the viewer's zone for no benefit, which is what the
 * repo's no-restricted-syntax rule exists to catch. Nothing here is persisted.
 *
 * Returns null when the date field is empty or unparseable; the caller falls
 * back to a "+4h" style label.
 */
export function formatSegmentWindow(
  scheduledAtLocal: string,
  startOffsetMinutes: number,
  durationMinutes: number,
): string | null {
  const hhmm = /T(\d{2}):(\d{2})/.exec(scheduledAtLocal);
  if (!hhmm) return null;
  const baseMinutes = Number(hhmm[1]) * 60 + Number(hhmm[2]);

  const fmt = (totalMinutes: number) => {
    const inDay = ((totalMinutes % 1440) + 1440) % 1440;
    const h24 = Math.floor(inDay / 60);
    const m = inDay % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
  };

  const start = baseMinutes + startOffsetMinutes;
  const end = start + durationMinutes;
  // A window crossing midnight is normal on a long job — say so rather than
  // printing two times that look like the job ran backwards.
  const daysOver = Math.floor(end / 1440) - Math.floor(start / 1440);
  return `${fmt(start)} – ${fmt(end)}${daysOver > 0 ? ` (+${daysOver}d)` : ""}`;
}

/**
 * The span from the earliest segment start to the latest segment end.
 *
 * With end-to-end segments this equals the sum of the durations, which is what
 * the old editor showed. With overlapping ones it does not, and the sum would
 * overstate how long the job actually takes — the number the owner needs when
 * setting the booking's own duration.
 */
export function segmentsSpanMinutes(segments: ResolvedSegment[]): number {
  const live = segments.filter((s) => s.assigned_to && s.duration_minutes > 0);
  if (live.length === 0) return 0;
  const start = Math.min(...live.map((s) => s.start_offset_minutes));
  const end = Math.max(
    ...live.map((s) => s.start_offset_minutes + s.duration_minutes),
  );
  return end - start;
}
