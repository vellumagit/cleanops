import { describe, it, expect } from "vitest";
import { deriveJobState, describeJobState, teamMinutes, type JobStateInput } from "./job-state";

const T = (iso: string) => new Date(iso).getTime();
// Lori Moeller, 2026-10-27: 9:00 AM Edmonton (15:00Z), 18h entered, 4 crew.
const START = "2026-10-27T15:00:00Z";
const P = "pristine", A = "alona", N = "anastasiia", I = "ivanna";

function input(over: Partial<JobStateInput> = {}): JobStateInput {
  return {
    booking: {
      status: "confirmed",
      scheduled_at: START,
      duration_minutes: 1080,
      total_cents: 36000,
      hourly_rate_cents: null,
      is_free: false,
      closed_at: null,
    },
    crew: [P, A, N, I].map((membership_id) => ({ membership_id })),
    shifts: [],
    now: T("2026-10-27T14:00:00Z"),
    autoCompleteAfterMinutes: 240,
    ...over,
  };
}
const shift = (who: string, inAt: string, outAt: string | null = null) => ({
  employee_id: who,
  clock_in_at: inAt,
  clock_out_at: outAt,
});

describe("teamMinutes — the hours entered are for one person", () => {
  it("shares the hours across the crew when the job divides them", () => {
    expect(teamMinutes({ duration_minutes: 1080, divides_hours: true }, 4)).toBe(270);
    expect(teamMinutes({ duration_minutes: 1080, divides_hours: true }, 3)).toBe(360);
    expect(teamMinutes({ duration_minutes: 100, divides_hours: true }, 3)).toBe(33);
  });

  it("leaves them alone for one person, or when dividing is off", () => {
    expect(teamMinutes({ duration_minutes: 1080, divides_hours: true }, 1)).toBe(1080);
    expect(teamMinutes({ duration_minutes: 1080, divides_hours: true }, 0)).toBe(1080);
    expect(teamMinutes({ duration_minutes: 1080, divides_hours: false }, 4)).toBe(1080);
    expect(teamMinutes({ duration_minutes: 1080 }, 4)).toBe(1080);
  });

  it("Lori Moeller with dividing on: the window ends at 1:30 PM, not 3 AM", () => {
    const divided = { ...input().booking, divides_hours: true };
    const s = deriveJobState(input({ booking: divided }));
    expect(s.windowEndMs).toBe(T("2026-10-27T19:30:00Z"));
    // Three worked 8:59–12:30, Ivanna never came. At 12:31 she's still
    // "coming"; at 1:31 PM the job is over without anyone touching it.
    const shifts = [
      shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
      shift(A, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
      shift(N, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
    ];
    const waiting = deriveJobState(input({ booking: divided, shifts, now: T("2026-10-27T18:31:00Z") }));
    expect(waiting.phase).toBe("finished_on_site");
    expect(waiting.closesAtMs).toBe(T("2026-10-27T19:30:00Z"));
    const over = deriveJobState(input({ booking: divided, shifts, now: T("2026-10-27T19:31:00Z") }));
    expect(over.phase).toBe("done");
    expect(over.status).toBe("completed");
    expect(over.noShows).toEqual([I]);
  });

  it("a split shift is not a divided job — the segments already fill the hours", () => {
    // 480 min entered, two people back to back (4h + 4h). Legacy rows carry
    // a length but no offset. Dividing by two would end the window at 4h
    // and call the second cleaner a no-show when the first one finished.
    const divided = { ...input().booking, duration_minutes: 480, divides_hours: true };
    const legacy = deriveJobState(input({
      booking: divided,
      crew: [
        { membership_id: P, split_duration_minutes: 240 },
        { membership_id: A, split_duration_minutes: 240 },
      ],
    }));
    expect(legacy.windowEndMs).toBe(T("2026-10-27T23:00:00Z"));
    const withOffsets = deriveJobState(input({
      booking: divided,
      crew: [
        { membership_id: P, split_start_offset_minutes: 0, split_duration_minutes: 240 },
        { membership_id: A, split_start_offset_minutes: 240, split_duration_minutes: 240 },
      ],
    }));
    expect(withOffsets.windowEndMs).toBe(T("2026-10-27T23:00:00Z"));
  });

  it("says who is still on the clock when the office closed the job around her", () => {
    const s = deriveJobState(input({
      booking: { ...input().booking, closed_at: "2026-10-27T18:00:00Z" },
      shifts: [shift(P, "2026-10-27T15:00:00Z")],
      now: T("2026-10-27T18:05:00Z"),
    }));
    expect(s.phase).toBe("done");
    expect(describeJobState(s, { nameOf: (id) => id, formatTime: () => "", crewSize: 4 })).toContain(
      "pristine still on the clock",
    );
  });

  it("a person's own later segment still stretches the window past the shared length", () => {
    const divided = { ...input().booking, divides_hours: true };
    const s = deriveJobState(input({
      booking: divided,
      crew: [
        { membership_id: P },
        { membership_id: A },
        { membership_id: I, split_start_offset_minutes: 300, split_duration_minutes: 120 },
      ],
    }));
    // 3 crew → 360 shared minutes ends 21:00Z; Ivanna's own 5h+2h ends 22:00Z.
    expect(s.windowEndMs).toBe(T("2026-10-27T22:00:00Z"));
  });
});

describe("deriveJobState", () => {
  it("is not started before anyone clocks in, and keeps the booked status", () => {
    const s = deriveJobState(input());
    expect(s.phase).toBe("not_started");
    expect(s.status).toBe("confirmed");
    expect(s.waitingOn).toEqual([P, A, N, I]);
    expect(deriveJobState(input({ booking: { ...input().booking, status: "pending" } })).status).toBe("pending");
  });

  it("is in progress the moment one person clocks in; the rest are still coming", () => {
    const s = deriveJobState(input({
      shifts: [shift(N, "2026-10-27T14:59:00Z")],
      now: T("2026-10-27T15:05:00Z"),
    }));
    expect(s.phase).toBe("in_progress");
    expect(s.status).toBe("in_progress");
    expect(s.onSite).toEqual([N]);
    expect(s.waitingOn).toEqual([P, A, I]);
    expect(s.noShows).toEqual([]);
  });

  it("2026-10-26: an early Finish does not close the job on people still coming", () => {
    // Olha clocked in first and tapped Finish six minutes later.
    const s = deriveJobState(input({
      shifts: [shift(N, "2026-10-27T14:59:00Z", "2026-10-27T15:05:00Z")],
      now: T("2026-10-27T15:06:00Z"),
    }));
    expect(s.phase).toBe("finished_on_site");
    expect(s.status).toBe("in_progress");
    expect(s.waitingOn).toEqual([P, A, I]);
    expect(s.needs).toEqual(["no_show_decision"]);
    expect(s.closesAtMs).toBe(T("2026-10-28T09:00:00Z"));
  });

  it("is done the moment the last rostered person clocks out", () => {
    const s = deriveJobState(input({
      shifts: [
        shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
        shift(A, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
        shift(N, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
        shift(I, "2026-10-27T15:10:00Z", "2026-10-27T18:31:00Z"),
      ],
      now: T("2026-10-27T18:31:30Z"),
    }));
    expect(s.phase).toBe("done");
    expect(s.status).toBe("completed");
    expect(s.needs).toEqual([]);
  });

  it("2026-10-27: a no-show holds the job open only until the window ends", () => {
    const three = [
      shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
      shift(A, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
      shift(N, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
    ];
    const afternoon = deriveJobState(input({ shifts: three, now: T("2026-10-27T23:00:00Z") }));
    expect(afternoon.phase).toBe("finished_on_site");
    expect(afternoon.waitingOn).toEqual([I]);
    expect(afternoon.needs).toContain("no_show_decision");

    const later = deriveJobState(input({ shifts: three, now: T("2026-10-28T09:00:00Z") }));
    expect(later.phase).toBe("done");
    expect(later.noShows).toEqual([I]);
  });

  it("a manager closing it ends the wait, whoever is still rostered", () => {
    const s = deriveJobState(input({
      booking: { ...input().booking, closed_at: "2026-10-27T23:25:00Z" },
      shifts: [shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
      now: T("2026-10-27T23:30:00Z"),
    }));
    expect(s.phase).toBe("done");
    expect(s.status).toBe("completed");
  });

  it("cannot be closed while someone is still on the clock — their shift stays open", () => {
    // closed_at wins for the job's status; the open shift is reported, not
    // cut. The clock-out cap handles the shift on its own schedule.
    const s = deriveJobState(input({
      booking: { ...input().booking, closed_at: "2026-10-27T23:25:00Z" },
      shifts: [shift(P, "2026-10-27T15:00:00Z")],
      now: T("2026-10-27T23:30:00Z"),
    }));
    expect(s.phase).toBe("done");
    expect(s.onSite).toEqual([P]);
  });

  it("flags a done job with no price, unless it is marked free", () => {
    const done = {
      shifts: [shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
      crew: [{ membership_id: P }],
      now: T("2026-10-27T18:31:00Z"),
    };
    const unpriced = deriveJobState(input({ ...done, booking: { ...input().booking, total_cents: 0 } }));
    expect(unpriced.phase).toBe("done");
    expect(unpriced.needs).toEqual(["price"]);
    const free = deriveJobState(input({ ...done, booking: { ...input().booking, total_cents: 0, is_free: true } }));
    expect(free.needs).toEqual([]);
    const hourly = deriveJobState(input({ ...done, booking: { ...input().booking, total_cents: 0, hourly_rate_cents: 4500 } }));
    expect(hourly.needs).toEqual([]);
  });

  it("a staffed job nobody tapped on becomes done after the org's auto-complete delay", () => {
    const past = input({ now: T("2026-10-28T10:00:00Z") });
    expect(deriveJobState(past).phase).toBe("not_started");
    expect(deriveJobState(past).closesAtMs).toBe(T("2026-10-28T13:00:00Z"));
    expect(deriveJobState({ ...past, now: T("2026-10-28T13:00:00Z") }).phase).toBe("done");
    // With auto-complete off it waits for a human.
    expect(deriveJobState({ ...past, now: T("2026-10-30T00:00:00Z"), autoCompleteAfterMinutes: null }).phase).toBe("not_started");
  });

  it("an unstaffed job past its window needs crew, and never auto-completes", () => {
    const s = deriveJobState(input({ crew: [], now: T("2026-10-29T00:00:00Z") }));
    expect(s.phase).toBe("not_started");
    expect(s.needs).toEqual(["crew"]);
  });

  it("a person's own later window extends the job's window", () => {
    const s = deriveJobState(input({
      crew: [{ membership_id: P }, { membership_id: A, split_start_offset_minutes: 1080, split_duration_minutes: 120 }],
      shifts: [shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z")],
      now: T("2026-10-28T09:30:00Z"),
    }));
    expect(s.windowEndMs).toBe(T("2026-10-28T11:00:00Z"));
    expect(s.phase).toBe("finished_on_site");
  });

  it("cancelled stays cancelled whatever the shifts say", () => {
    const s = deriveJobState(input({
      booking: { ...input().booking, status: "cancelled" },
      shifts: [shift(P, "2026-10-27T15:00:00Z")],
    }));
    expect(s.phase).toBe("cancelled");
    expect(s.status).toBe("cancelled");
  });
});

describe("describeJobState", () => {
  const names: Record<string, string> = { [P]: "Pristine", [A]: "Alona", [N]: "Anastasiia", [I]: "Ivanna" };
  const opts = {
    nameOf: (id: string) => names[id] ?? id,
    formatTime: (ms: number) => new Date(ms).toISOString().slice(11, 16) + "Z",
    crewSize: 4,
  };

  it("reads as one plain line", () => {
    const three = [
      shift(P, "2026-10-27T15:00:00Z", "2026-10-27T18:30:00Z"),
      shift(A, "2026-10-27T14:59:00Z", "2026-10-27T18:30:00Z"),
      shift(N, "2026-10-27T14:59:00Z"),
    ];
    expect(describeJobState(deriveJobState(input({ shifts: three, now: T("2026-10-27T18:31:00Z") })), opts))
      .toBe("1 of 4 on site · Pristine, Alona finished · waiting on Ivanna");
    three[2].clock_out_at = "2026-10-27T18:30:00Z";
    expect(describeJobState(deriveJobState(input({ shifts: three, now: T("2026-10-27T23:00:00Z") })), opts))
      .toBe("Finished on site · waiting on Ivanna · closes itself 09:00Z");
    expect(describeJobState(deriveJobState(input({ shifts: three, now: T("2026-10-28T09:00:00Z"), booking: { ...input().booking, total_cents: 0 } })), opts))
      .toBe("Done · Ivanna never clocked in · needs a price");
  });
});
