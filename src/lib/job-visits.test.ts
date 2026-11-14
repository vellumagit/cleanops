import { describe, it, expect } from "vitest";
import {
  groupIntoVisits,
  judgeCompletion,
  type VisitEntry,
} from "./job-visits";

const dayOf = (iso: string) => iso.slice(0, 10);

let n = 0;
function punch(
  inIso: string,
  outIso: string | null,
  over: Partial<VisitEntry> = {},
): VisitEntry {
  const actual = outIso
    ? Math.round((Date.parse(outIso) - Date.parse(inIso)) / 60_000)
    : 0;
  return {
    id: `e${++n}`,
    employee_id: "john",
    booking_id: "riverbend",
    clock_in_at: inIso,
    clock_out_at: outIso,
    actual_minutes: actual,
    is_open: outIso == null,
    earned_cents: actual * 100,
    estimated_minutes: 15,
    punctuality: "on_time",
    punctuality_minutes: 0,
    needs_review: false,
    over_allotted_minutes: 0,
    over_confirmed: false,
    shift_start_at: "2026-11-14T20:29:00Z",
    ...over,
  };
}

describe("groupIntoVisits", () => {
  it("reads four punches on one job as one visit (Brian, 2026-11-14)", () => {
    // Newest first, the way the timesheet query returns them. Later punches
    // carry the per-punch "late" each resume used to be judged by.
    const entries = [
      punch("2026-11-14T20:47:00Z", "2026-11-14T20:49:00Z", {
        punctuality: "late",
        punctuality_minutes: 18,
      }),
      punch("2026-11-14T20:44:00Z", "2026-11-14T20:47:00Z", {
        punctuality: "late",
        punctuality_minutes: 14,
      }),
      punch("2026-11-14T20:38:00Z", "2026-11-14T20:43:00Z", {
        punctuality: "late",
        punctuality_minutes: 9,
      }),
      punch("2026-11-14T20:31:00Z", "2026-11-14T20:36:00Z"),
    ];
    const visits = groupIntoVisits(entries, dayOf);
    expect(visits).toHaveLength(1);
    const v = visits[0];
    expect(v.punch_count).toBe(4);
    expect(v.worked_minutes).toBe(15);
    expect(v.earned_cents).toBe(1500);
    // 20:36→20:38, 20:43→20:44, 20:47→20:47
    expect(v.break_minutes).toBe(3);
    expect(v.clock_in_at).toBe("2026-11-14T20:31:00Z");
    expect(v.clock_out_at).toBe("2026-11-14T20:49:00Z");
    // Arrival is the first clock-in only — the resumes aren't "late".
    expect(v.punctuality).toBe("on_time");
    // 15 worked against a 15-minute job: on target, not "10m faster" x4.
    expect(v.completion).toBe("on_target");
    expect(v.entries.map((e) => e.clock_in_at)).toEqual([
      "2026-11-14T20:31:00Z",
      "2026-11-14T20:38:00Z",
      "2026-11-14T20:44:00Z",
      "2026-11-14T20:47:00Z",
    ]);
  });

  it("keeps different jobs, people and days apart", () => {
    const visits = groupIntoVisits(
      [
        punch("2026-11-14T16:00:00Z", "2026-11-14T17:00:00Z"),
        punch("2026-11-14T18:00:00Z", "2026-11-14T19:00:00Z", {
          booking_id: "other-job",
        }),
        punch("2026-11-14T18:00:00Z", "2026-11-14T19:00:00Z", {
          employee_id: "olha",
        }),
        punch("2026-11-15T16:00:00Z", "2026-11-15T17:00:00Z"),
      ],
      dayOf,
    );
    expect(visits).toHaveLength(4);
  });

  it("never merges off-job punches", () => {
    const visits = groupIntoVisits(
      [
        punch("2026-11-14T16:00:00Z", "2026-11-14T17:00:00Z", {
          booking_id: null,
        }),
        punch("2026-11-14T18:00:00Z", "2026-11-14T19:00:00Z", {
          booking_id: null,
        }),
      ],
      dayOf,
    );
    expect(visits).toHaveLength(2);
    expect(visits.every((v) => v.break_minutes === 0)).toBe(true);
  });

  it("returns visits newest first", () => {
    const visits = groupIntoVisits(
      [
        punch("2026-11-13T16:00:00Z", "2026-11-13T17:00:00Z"),
        punch("2026-11-14T16:00:00Z", "2026-11-14T17:00:00Z"),
      ],
      dayOf,
    );
    expect(visits.map((v) => v.clock_in_at.slice(0, 10))).toEqual([
      "2026-11-14",
      "2026-11-13",
    ]);
  });

  it("an open punch keeps the visit open and unjudged", () => {
    const [v] = groupIntoVisits(
      [
        punch("2026-11-14T20:31:00Z", "2026-11-14T20:36:00Z"),
        punch("2026-11-14T20:40:00Z", null),
      ],
      dayOf,
    );
    expect(v.is_open).toBe(true);
    expect(v.clock_out_at).toBeNull();
    expect(v.worked_minutes).toBe(5);
    expect(v.break_minutes).toBe(4);
    expect(v.completion).toBeNull();
  });

  it("overlapping punches are not a negative break", () => {
    const [v] = groupIntoVisits(
      [
        punch("2026-11-14T16:00:00Z", "2026-11-14T17:00:00Z"),
        punch("2026-11-14T16:30:00Z", "2026-11-14T17:30:00Z"),
      ],
      dayOf,
    );
    expect(v.break_minutes).toBe(0);
  });

  describe("over the allotment", () => {
    const twoHourJob = {
      estimated_minutes: 120,
      shift_start_at: "2026-11-14T16:00:00Z",
    };

    it("a single punch keeps its own overrun exactly", () => {
      const [v] = groupIntoVisits(
        [
          punch("2026-11-14T16:00:00Z", "2026-11-14T18:40:00Z", {
            ...twoHourJob,
            over_allotted_minutes: 40,
          }),
        ],
        dayOf,
      );
      expect(v.over_allotted_minutes).toBe(40);
    });

    it("counts every punch against one allotment", () => {
      // Two 75-minute punches on a 2-hour job: each looked fine on its own
      // (every resume got the whole two hours again), together 30 over.
      const [v] = groupIntoVisits(
        [
          punch("2026-11-14T16:00:00Z", "2026-11-14T17:15:00Z", twoHourJob),
          punch("2026-11-14T17:45:00Z", "2026-11-14T19:00:00Z", twoHourJob),
        ],
        dayOf,
      );
      expect(v.over_allotted_minutes).toBe(30);
    });

    it("doesn't count time before the window opened", () => {
      // Early starter: 30 minutes before the job's start is not overrun,
      // same as the single-punch max(start, clock-in) rule.
      const [v] = groupIntoVisits(
        [
          punch("2026-11-14T15:30:00Z", "2026-11-14T17:00:00Z", twoHourJob),
          punch("2026-11-14T17:10:00Z", "2026-11-14T18:00:00Z", twoHourJob),
        ],
        dayOf,
      );
      expect(v.over_allotted_minutes).toBe(0);
    });

    it("clears once every punch is confirmed, and returns with a new one", () => {
      const confirmed = { ...twoHourJob, over_confirmed: true };
      const a = punch("2026-11-14T16:00:00Z", "2026-11-14T17:15:00Z", confirmed);
      const b = punch("2026-11-14T17:45:00Z", "2026-11-14T19:00:00Z", confirmed);
      expect(groupIntoVisits([a, b], dayOf)[0].over_allotted_minutes).toBe(0);
      const c = punch("2026-11-14T19:10:00Z", "2026-11-14T19:30:00Z", twoHourJob);
      expect(groupIntoVisits([a, b, c], dayOf)[0].over_allotted_minutes).toBe(50);
    });
  });

  it("a review flag on any punch flags the visit", () => {
    const [v] = groupIntoVisits(
      [
        punch("2026-11-14T16:00:00Z", "2026-11-14T16:10:00Z"),
        punch("2026-11-14T16:20:00Z", "2026-11-14T16:30:00Z", {
          needs_review: true,
        }),
      ],
      dayOf,
    );
    expect(v.needs_review).toBe(true);
  });
});

describe("judgeCompletion", () => {
  it("allows five minutes either way", () => {
    expect(judgeCompletion(60, 65).completion).toBe("on_target");
    expect(judgeCompletion(60, 66)).toEqual({ completion: "under", diffMinutes: 6 });
    expect(judgeCompletion(72, 66)).toEqual({ completion: "over", diffMinutes: 6 });
  });
  it("no judgement without an allotment or any time", () => {
    expect(judgeCompletion(60, null).completion).toBeNull();
    expect(judgeCompletion(0, 60).completion).toBeNull();
  });
});
