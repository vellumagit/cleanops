import { describe, it, expect } from "vitest";
import { deriveJobState, describeJobState, type JobStateInput } from "./job-state";

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
