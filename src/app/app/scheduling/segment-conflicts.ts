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

export type ScheduleConflictWindow = {
  membership_id: string;
  start_at: string;
  end_at: string;
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

export function getScheduleConflictWindows(args: {
  scheduledAt: string;
  bookingDuration: number;
  segments: SegmentWindow[];
}): ScheduleConflictWindow[] {
  const bookingStart = new Date(args.scheduledAt).getTime();
  if (!Number.isFinite(bookingStart)) return [];

  return args.segments.flatMap((segment) => {
    const offset = Math.max(0, segment.start_offset_minutes ?? 0);
    const duration = Math.max(
      0,
      segment.duration_minutes ?? args.bookingDuration,
    );
    if (duration === 0) return [];

    return [
      {
        membership_id: segment.membership_id,
        start_at: new Date(bookingStart + offset * 60_000).toISOString(),
        end_at: new Date(
          bookingStart + (offset + duration) * 60_000,
        ).toISOString(),
      },
    ];
  });
}

export function hasSplitScheduleConflict(args: {
  bookingId: string;
  scheduledAt: string;
  bookingDuration: number;
  segments: SegmentWindow[];
  otherAssignments: ScheduleAssignment[];
}): boolean {
  const proposed = getScheduleConflictWindows(args).map((window) => ({
    membershipId: window.membership_id,
    start: new Date(window.start_at).getTime(),
    end: new Date(window.end_at).getTime(),
  }));

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
