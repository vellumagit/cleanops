import { describe, it, expect } from "vitest";
import { deriveJobState, describeJobState, finishesBeforeCutover, reopensBeforeCutover, teamMinutes, type JobStateInput } from "./job-state";

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
    // "En route" is the office's word too; the rules don't take it back.
    expect(deriveJobState(input({ booking: { ...input().booking, status: "en_route" } })).status).toBe("en_route");
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

describe("finishesBeforeCutover — the one answer stored while in shadow", () => {
  // Oliver Little, 2026-10-28: 9:00 AM (15:00Z), three crew. One clocked out
  // from her phone at 3:24 PM; the office ended the other two at 4:20 PM.
  const OL = "2026-10-28T15:00:00Z";
  const crew3 = [P, A, I].map((membership_id) => ({ membership_id }));
  const oliver = (shifts: ReturnType<typeof shift>[], now: string, status = "in_progress") => {
    const inp = input({
      booking: { ...input().booking, status, scheduled_at: OL, divides_hours: true },
      crew: crew3,
      shifts,
      now: T(now),
    });
    return finishesBeforeCutover(status, deriveJobState(inp), T(OL), T(now));
  };
  const allOut = [
    shift(P, "2026-10-28T15:15:00Z", "2026-10-28T21:24:31Z"),
    shift(A, "2026-10-28T15:15:00Z", "2026-10-28T22:20:00Z"),
    shift(I, "2026-10-28T15:15:00Z", "2026-10-28T22:20:00Z"),
  ];

  it("finishes the job when the office ends the last open shifts", () => {
    expect(oliver(allOut, "2026-10-28T22:20:56Z")).toBe(true);
  });
  it("finishes a job whose clock-in never moved the row off confirmed", () => {
    expect(oliver(allOut, "2026-10-28T22:20:56Z", "confirmed")).toBe(true);
  });
  it("waits while anyone is still on the clock", () => {
    const oneOpen = [...allOut.slice(0, 2), shift(I, "2026-10-28T15:15:00Z")];
    expect(oliver(oneOpen, "2026-10-28T22:20:56Z")).toBe(false);
  });
  it("waits for a rostered person still coming, until the window ends", () => {
    const twoCame = allOut.slice(0, 2);
    // Window: 18h shared by three = 6h, so 3:00 PM (21:00Z).
    expect(oliver(twoCame, "2026-10-28T17:00:00Z")).toBe(false);
    expect(oliver(twoCame, "2026-10-28T22:20:56Z")).toBe(true);
  });
  it("leaves a job nobody worked to the nightly sweep", () => {
    expect(oliver([], "2026-10-29T08:00:00Z")).toBe(false);
  });
  it("never touches a job that is already closed or cancelled", () => {
    expect(oliver(allOut, "2026-10-28T22:20:56Z", "completed")).toBe(false);
    expect(oliver(allOut, "2026-10-28T22:20:56Z", "cancelled")).toBe(false);
  });
  it("never finishes a job dated in the future (moved while she was on the clock)", () => {
    const state = deriveJobState(input({
      booking: { ...input().booking, status: "in_progress", scheduled_at: "2026-11-02T15:00:00Z" },
      crew: crew3,
      shifts: allOut,
      now: T("2026-10-28T22:20:56Z"),
    }));
    expect(finishesBeforeCutover("in_progress", state, T("2026-11-02T15:00:00Z"), T("2026-10-28T22:20:56Z"))).toBe(false);
  });
});

describe("reopensBeforeCutover — a job Sollos closed is not stuck closed", () => {
  const OL = "2026-10-28T15:00:00Z";
  const crew3 = [P, A, I].map((membership_id) => ({ membership_id }));
  const at = (now: string, shifts: ReturnType<typeof shift>[], closed_at: string | null = null) =>
    deriveJobState(input({
      booking: { ...input().booking, status: "completed", scheduled_at: OL, divides_hours: true, closed_at },
      crew: crew3,
      shifts,
      now: T(now),
    }));
  const twoOut = [
    shift(P, "2026-10-28T15:15:00Z", "2026-10-28T21:24:31Z"),
    shift(A, "2026-10-28T15:15:00Z", "2026-10-28T22:20:00Z"),
  ];

  it("reopens when a queued I'm here lands after the office ended the last shift", () => {
    const late = [...twoOut, shift(I, "2026-10-28T19:00:00Z")];
    expect(reopensBeforeCutover("completed", null, at("2026-10-28T22:30:00Z", late))).toBe(true);
  });
  it("reopens when someone clocks back in after a break", () => {
    const back = [...twoOut, shift(I, "2026-10-28T15:15:00Z", "2026-10-28T18:00:00Z"), shift(I, "2026-10-28T18:40:00Z")];
    expect(reopensBeforeCutover("completed", null, at("2026-10-28T18:41:00Z", back))).toBe(true);
  });
  it("never reopens a job a person closed", () => {
    const late = [...twoOut, shift(I, "2026-10-28T19:00:00Z")];
    expect(reopensBeforeCutover("completed", "2026-10-28T23:22:46Z", at("2026-10-28T23:30:00Z", late, "2026-10-28T23:22:46Z"))).toBe(false);
  });
  it("does nothing while everyone is out, or on a job that isn't completed", () => {
    expect(reopensBeforeCutover("completed", null, at("2026-10-28T22:30:00Z", twoOut))).toBe(false);
    const late = [...twoOut, shift(I, "2026-10-28T19:00:00Z")];
    expect(reopensBeforeCutover("in_progress", null, at("2026-10-28T22:30:00Z", late))).toBe(false);
  });
});

describe("finish/reopen invariants over random jobs", () => {
  // A small seeded generator so the cases are the same every run. 3000
  // jobs: 0–4 rostered, each with no shift, a closed shift, an open one,
  // or two shifts; row status and closed_at random; now anywhere from
  // before the start to a day past the window.
  let seed = 20261029;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const START_MS = T(START);
  const statuses = ["pending", "confirmed", "en_route", "in_progress", "completed", "cancelled"];

  function randomJob() {
    const crewN = Math.floor(rnd() * 5);
    const crew = [P, A, N, I].slice(0, crewN).map((membership_id) => ({ membership_id }));
    const shifts: ReturnType<typeof shift>[] = [];
    for (const c of crew) {
      const kind = pick(["none", "closed", "open", "two"]);
      const inAt = START_MS + Math.floor(rnd() * 4 * 3_600_000) - 1_800_000;
      const outAt = inAt + 600_000 + Math.floor(rnd() * 6 * 3_600_000);
      if (kind === "closed" || kind === "two") shifts.push(shift(c.membership_id, new Date(inAt).toISOString(), new Date(outAt).toISOString()));
      if (kind === "open") shifts.push(shift(c.membership_id, new Date(inAt).toISOString()));
      if (kind === "two") shifts.push(shift(c.membership_id, new Date(outAt + 1_800_000).toISOString(), rnd() < 0.5 ? null : new Date(outAt + 3_600_000).toISOString()));
    }
    // Someone off the roster with hours on the job, now and then.
    if (rnd() < 0.1) shifts.push(shift("stranger", new Date(START_MS + 600_000).toISOString(), new Date(START_MS + 3_600_000).toISOString()));
    const status = pick(statuses);
    const closed_at = rnd() < 0.2 ? new Date(START_MS + 5 * 3_600_000).toISOString() : null;
    const now = START_MS - 3_600_000 + Math.floor(rnd() * 30 * 3_600_000);
    const inp = input({
      booking: { ...input().booking, status, closed_at, divides_hours: rnd() < 0.7, duration_minutes: pick([120, 360, 1080]) },
      crew,
      shifts,
      now,
    });
    return { inp, status, closed_at, now };
  }

  it("holds on 3000 random jobs", () => {
    for (let i = 0; i < 3000; i++) {
      const { inp, status, closed_at, now } = randomJob();
      const state = deriveJobState(inp);
      const finish = finishesBeforeCutover(status, state, START_MS, now);
      const reopen = reopensBeforeCutover(status, closed_at, state);
      const label = `case ${i}: status=${status} closed_at=${closed_at} now=+${Math.round((now - START_MS) / 60000)}m crew=${inp.crew.length} shifts=${JSON.stringify(inp.shifts)}`;

      // Never both.
      expect(finish && reopen, label).toBe(false);

      if (finish) {
        // Nobody on the clock, someone worked, the job has started, the row was open.
        expect(state.onSite, label).toEqual([]);
        expect(state.finished.length, label).toBeGreaterThan(0);
        expect(now, label).toBeGreaterThanOrEqual(START_MS);
        expect(["in_progress", "en_route", "confirmed"], label).toContain(status);
        // Nobody rostered is still expected — each either worked, or the
        // window is over — unless a person closed it, which outranks waiting.
        if (closed_at == null) expect(state.waitingOn, label).toEqual([]);
        // Stable: stored as completed, the next look neither finishes nor reopens.
        const again = deriveJobState({ ...inp, booking: { ...inp.booking, status: "completed" } });
        expect(finishesBeforeCutover("completed", again, START_MS, now), label).toBe(false);
        expect(reopensBeforeCutover("completed", closed_at, again), label).toBe(false);
        // Someone clocking in now reverses it (unless a person had closed it).
        const back = deriveJobState({ ...inp, booking: { ...inp.booking, status: "completed" }, shifts: [...inp.shifts, shift(P, new Date(now).toISOString())] });
        expect(reopensBeforeCutover("completed", closed_at, back), label).toBe(closed_at == null);
      }

      if (reopen) {
        expect(status, label).toBe("completed");
        expect(closed_at, label).toBeNull();
        expect(state.onSite.length, label).toBeGreaterThan(0);
        // Stable: stored as in progress, the next look does nothing more.
        const again = deriveJobState({ ...inp, booking: { ...inp.booking, status: "in_progress" } });
        expect(reopensBeforeCutover("in_progress", closed_at, again), label).toBe(false);
        expect(finishesBeforeCutover("in_progress", again, START_MS, now), label).toBe(false);
      }

      // A person's close is never undone, and a cancelled job is never touched.
      if (closed_at != null) expect(reopen, label).toBe(false);
      if (status === "cancelled") expect(finish || reopen, label).toBe(false);
      // A job nobody worked is never finished here (that stays with the sweep).
      if (inp.shifts.length === 0) expect(finish, label).toBe(false);
    }
  });
});
