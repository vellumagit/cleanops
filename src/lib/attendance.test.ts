import { describe, expect, it } from "vitest";
import {
  attendanceExceptions,
  attendanceMark,
  summarizeAttendance,
  type AttendanceJob,
} from "./attendance";

const T = (iso: string) => new Date(iso).getTime();
const shift = (who: string, inAt: string, outAt: string | null = null) => ({
  employee_id: who,
  clock_in_at: inAt,
  clock_out_at: outAt,
});

function job(over: Partial<AttendanceJob> & { crewIds?: string[] } = {}): AttendanceJob {
  const { crewIds, ...rest } = over;
  return {
    bookingId: "b1",
    booking: {
      status: "confirmed",
      scheduled_at: "2026-10-27T15:00:00Z",
      duration_minutes: 180,
      divides_hours: false,
    },
    crew: (crewIds ?? ["me"]).map((membership_id) => ({ membership_id })),
    shifts: [],
    ...rest,
  };
}

describe("attendanceMark", () => {
  it("is on time within five minutes of the start, late past it", () => {
    const now = T("2026-10-28T00:00:00Z");
    const onTime = attendanceMark(
      job({ shifts: [shift("me", "2026-10-27T15:05:00Z", "2026-10-27T18:00:00Z")] }),
      "me",
      now,
    );
    expect(onTime?.kind).toBe("on_time");
    expect(onTime?.lateByMinutes).toBe(0);

    const late = attendanceMark(
      job({ shifts: [shift("me", "2026-10-27T15:06:00Z", "2026-10-27T18:00:00Z")] }),
      "me",
      now,
    );
    expect(late?.kind).toBe("late");
    expect(late?.lateByMinutes).toBe(6);
  });

  it("measures her first clock-in, not a later one after a break", () => {
    const m = attendanceMark(
      job({
        shifts: [
          shift("me", "2026-10-27T16:30:00Z", "2026-10-27T18:00:00Z"),
          shift("me", "2026-10-27T14:58:00Z", "2026-10-27T16:00:00Z"),
        ],
      }),
      "me",
      T("2026-10-28T00:00:00Z"),
    );
    expect(m?.kind).toBe("on_time");
    expect(m?.arrivedMs).toBe(T("2026-10-27T14:58:00Z"));
    expect(m?.leftMs).toBe(T("2026-10-27T18:00:00Z"));
    expect(m?.overByMinutes).toBe(0);
  });

  it("is a no-show only once the job's window is over", () => {
    const j = job({ crewIds: ["me", "her"], shifts: [shift("her", "2026-10-27T15:00:00Z")] });
    // 2 of 3 hours in: still coming.
    expect(attendanceMark(j, "me", T("2026-10-27T17:00:00Z"))).toBeNull();
    const m = attendanceMark(j, "me", T("2026-10-27T18:00:00Z"));
    expect(m?.kind).toBe("no_show");
    expect(m?.othersWorked).toBe(true);
  });

  it("says when nobody on the job tapped at all", () => {
    const m = attendanceMark(job({ crewIds: ["me", "her"] }), "me", T("2026-10-28T00:00:00Z"));
    expect(m?.kind).toBe("no_show");
    expect(m?.othersWorked).toBe(false);
  });

  it("judges the second cleaner on a hand-off against her own segment", () => {
    const j = job({
      booking: {
        status: "confirmed",
        scheduled_at: "2026-10-27T15:00:00Z",
        duration_minutes: 480,
        divides_hours: false,
      },
      crew: [
        { membership_id: "first", split_start_offset_minutes: 0, split_duration_minutes: 240 },
        { membership_id: "me", split_start_offset_minutes: 240, split_duration_minutes: 240 },
      ],
      shifts: [
        shift("first", "2026-10-27T15:00:00Z", "2026-10-27T19:00:00Z"),
        shift("me", "2026-10-27T19:02:00Z", "2026-10-27T23:00:00Z"),
      ],
    });
    const m = attendanceMark(j, "me", T("2026-10-28T00:00:00Z"));
    expect(m?.kind).toBe("on_time");
    expect(m?.expectedStartMs).toBe(T("2026-10-27T19:00:00Z"));
    expect(m?.expectedEndMs).toBe(T("2026-10-27T23:00:00Z"));
    expect(m?.overByMinutes).toBe(0);
  });

  it("measures over-time against her share of a divided job", () => {
    // 18 hours for four: 4.5 each. She worked 15:00 to 20:00 — 30 over.
    const j = job({
      booking: {
        status: "confirmed",
        scheduled_at: "2026-10-27T15:00:00Z",
        duration_minutes: 1080,
        divides_hours: true,
      },
      crewIds: ["me", "a", "b", "c"],
      shifts: [shift("me", "2026-10-27T15:00:00Z", "2026-10-27T20:00:00Z")],
    });
    const m = attendanceMark(j, "me", T("2026-10-28T12:00:00Z"));
    expect(m?.expectedEndMs).toBe(T("2026-10-27T19:30:00Z"));
    expect(m?.overByMinutes).toBe(30);
  });

  it("does not count an open shift as over, and can be late and over at once", () => {
    const open = attendanceMark(
      job({ shifts: [shift("me", "2026-10-27T15:00:00Z")] }),
      "me",
      T("2026-10-27T23:00:00Z"),
    );
    expect(open?.leftMs).toBeNull();
    expect(open?.overByMinutes).toBe(0);

    // 20 late, left 40 past the window: she worked her 3 hours from 15:20,
    // so only the last 20 are "over". The late start is counted once.
    const both = attendanceMark(
      job({ shifts: [shift("me", "2026-10-27T15:20:00Z", "2026-10-27T18:40:00Z")] }),
      "me",
      T("2026-10-28T00:00:00Z"),
    );
    expect(both?.kind).toBe("late");
    expect(both?.lateByMinutes).toBe(20);
    expect(both?.overByMinutes).toBe(20);

    // 20 late, left 20 past the window: late, full length, not over.
    const shifted = attendanceMark(
      job({ shifts: [shift("me", "2026-10-27T15:20:00Z", "2026-10-27T18:20:00Z")] }),
      "me",
      T("2026-10-28T00:00:00Z"),
    );
    expect(shifted?.kind).toBe("late");
    expect(shifted?.overByMinutes).toBe(0);
  });

  it("has nothing to say about a cancelled job or a job she was not on", () => {
    const now = T("2026-10-28T00:00:00Z");
    expect(
      attendanceMark(job({ booking: { ...job().booking, status: "cancelled" } }), "me", now),
    ).toBeNull();
    expect(attendanceMark(job({ crewIds: ["her"] }), "me", now)).toBeNull();
  });
});

describe("summarizeAttendance / attendanceExceptions", () => {
  const now = T("2026-11-01T00:00:00Z");
  const marks = [
    attendanceMark(job({ bookingId: "a", shifts: [shift("me", "2026-10-27T15:00:00Z", "2026-10-27T18:00:00Z")] }), "me", now),
    attendanceMark(job({ bookingId: "b", shifts: [shift("me", "2026-10-27T15:10:00Z", "2026-10-27T18:00:00Z")] }), "me", now),
    attendanceMark(job({ bookingId: "c", shifts: [shift("me", "2026-10-27T15:20:00Z", "2026-10-27T18:00:00Z")] }), "me", now),
    attendanceMark(job({ bookingId: "d", shifts: [shift("me", "2026-10-27T15:00:00Z", "2026-10-27T19:00:00Z")] }), "me", now),
    attendanceMark(job({ bookingId: "e", crewIds: ["me", "her"], shifts: [shift("her", "2026-10-27T15:00:00Z", "2026-10-27T18:00:00Z")] }), "me", now),
    attendanceMark(job({ bookingId: "f", crewIds: ["me"] }), "me", now),
  ].filter((m): m is NonNullable<typeof m> => m != null);

  it("counts each kind once and averages lateness over the late jobs only", () => {
    expect(summarizeAttendance(marks)).toEqual({
      jobs: 6,
      onTime: 2,
      late: 2,
      lateAverageMinutes: 15,
      noShows: 2,
      noShowsNobodyTapped: 1,
      ranOver: 1,
    });
  });

  it("lists everything that was not simply on time", () => {
    expect(attendanceExceptions(marks).map((m) => m.bookingId)).toEqual(["b", "c", "d", "e", "f"]);
  });
});
