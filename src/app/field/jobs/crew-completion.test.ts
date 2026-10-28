import { describe, expect, it } from "vitest";
import { crewStillWorking, type CrewCompletionRow } from "./crew-completion";

const row = (id: string, done = false): CrewCompletionRow => ({
  membership_id: id,
  completed_at: done ? "2026-10-02T20:00:00Z" : null,
});

describe("crewStillWorking", () => {
  it("lets a solo job finish on the first tap", () => {
    expect(
      crewStillWorking({
        assignees: [row("olha")],
        workedIds: ["olha"],
        callerId: "olha",
      }),
    ).toBe(false);
  });

  it("holds a team job open while a crewmate is still clocked in", () => {
    // The 2026-10-02 case: three people, no split data. Before the fix this
    // returned false and the first Complete ended the job for everyone.
    expect(
      crewStillWorking({
        assignees: [row("veronika"), row("olha"), row("anastasiia")],
        workedIds: ["anastasiia", "olha"],
        callerId: "anastasiia",
      }),
    ).toBe(true);
  });

  it("finishes once the last person who worked taps Complete", () => {
    expect(
      crewStillWorking({
        assignees: [row("olha", true), row("anastasiia")],
        workedIds: ["olha", "anastasiia"],
        callerId: "anastasiia",
      }),
    ).toBe(false);
  });

  it("ignores a crewmate who was rostered but never clocked in", () => {
    // Veronika is assigned but never showed. She must not strand the booking
    // in in_progress — that withholds the draft invoice too.
    expect(
      crewStillWorking({
        assignees: [row("veronika"), row("olha", true), row("anastasiia")],
        workedIds: ["olha", "anastasiia"],
        callerId: "anastasiia",
      }),
    ).toBe(false);
  });

  it("counts the caller as done even when their row says otherwise", () => {
    // completed_at is written just before this check, and the read can race it.
    expect(
      crewStillWorking({
        assignees: [row("olha", true), row("anastasiia", false)],
        workedIds: ["olha", "anastasiia"],
        callerId: "anastasiia",
      }),
    ).toBe(false);
  });

  it("does not depend on split data — the old gate the bug hid behind", () => {
    // Nothing in the input carries split_duration_minutes any more. A plain
    // team job is protected exactly like a hand-off.
    expect(
      crewStillWorking({
        assignees: [row("a"), row("b")],
        workedIds: ["a", "b"],
        callerId: "a",
      }),
    ).toBe(true);
  });

  it("without clock data, a crewmate who left without tapping still holds (old callers)", () => {
    expect(
      crewStillWorking({
        assignees: [row("a"), row("b")],
        workedIds: ["a", "b"],
        callerId: "b",
      }),
    ).toBe(true);
  });

  it("with clock data, off the clock means finished — her tap only ever spoke for her shift", () => {
    // 'a' stopped her clock from the Clock page ("Just stop my clock"), so
    // she has a closed entry and no completed_at. The last finisher's I'm
    // done must close the job, not wait for a mark she has no way to make.
    expect(
      crewStillWorking({
        assignees: [row("a"), row("b")],
        workedIds: ["a", "b"],
        onClockIds: [],
        callerId: "b",
      }),
    ).toBe(false);
  });

  it("with clock data, an open clock holds the job even if her row says done", () => {
    // She tapped I'm done earlier, then "Not done? I'm back" — the clock-in
    // is what matters, whatever the row got to.
    expect(
      crewStillWorking({
        assignees: [row("a", true), row("b")],
        workedIds: ["a", "b"],
        onClockIds: ["a"],
        callerId: "b",
      }),
    ).toBe(true);
  });

  it("handles an empty crew list without throwing", () => {
    expect(
      crewStillWorking({ assignees: [], workedIds: [], callerId: "a" }),
    ).toBe(false);
  });
});

describe("crew who haven't clocked in yet", () => {
  it("keep the job open until its scheduled window is over (2026-10-26)", () => {
    // Olha clocked in first and tapped Finish; three others hadn't started.
    const crew = [row("pristine"), row("alona"), row("vira"), row("olha", true)];
    expect(
      crewStillWorking({ assignees: crew, workedIds: ["olha"], callerId: "olha", jobWindowOver: false }),
    ).toBe(true);
  });

  it("count as no-shows once the window has passed, so the job can close", () => {
    const crew = [row("pristine"), row("olha", true)];
    expect(
      crewStillWorking({ assignees: crew, workedIds: ["olha"], callerId: "olha", jobWindowOver: true }),
    ).toBe(false);
  });
});
