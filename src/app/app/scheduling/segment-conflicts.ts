export type SegmentWindow = {
  membership_id: string;
  start_offset_minutes: number | null;
  duration_minutes: number | null;
};

export type ScheduleAssignment = {
  booking_id: string;
  membership_id: string;
  scheduled_at: string;
  booking_duration_minutes: number;
  status: string;
  split_start_offset_minutes: number | null;
  split_duration_minutes: number | null;
};

function interval(
  scheduledAt: string,
  bookingDuration: number,
  startOffset: number | null,
  segmentDuration: number | null,
): { start: number; end: number } | null {
  const start = new Date(scheduledAt).getTime();
  const offset = Math.max(0, startOffset ?? 0);
  const duration = Math.max(0, segmentDuration ?? bookingDuration);
  if (!Number.isFinite(start) || duration === 0) return null;
  const from = start + offset * 60_000;
  return { start: from, end: from + duration * 60_000 };
}

export function hasSplitScheduleConflict(args: {
  bookingId: string;
  scheduledAt: string;
  bookingDuration: number;
  segments: SegmentWindow[];
  otherAssignments: ScheduleAssignment[];
}): boolean {
  const proposed = args.segments.flatMap((segment) => {
    const window = interval(
      args.scheduledAt,
      args.bookingDuration,
      segment.start_offset_minutes,
      segment.duration_minutes,
    );
    return window ? [{ membershipId: segment.membership_id, ...window }] : [];
  });

  return args.otherAssignments.some((assignment) => {
    if (
      assignment.booking_id === args.bookingId ||
      assignment.status === "cancelled"
    ) {
      return false;
    }

    const proposedWindow = proposed.find(
      (window) => window.membershipId === assignment.membership_id,
    );
    if (!proposedWindow) return false;

    const otherWindow = interval(
      assignment.scheduled_at,
      assignment.booking_duration_minutes,
      assignment.split_start_offset_minutes,
      assignment.split_duration_minutes,
    );
    return (
      otherWindow != null &&
      otherWindow.start < proposedWindow.end &&
      otherWindow.end > proposedWindow.start
    );
  });
}
