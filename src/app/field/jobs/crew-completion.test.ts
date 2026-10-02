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

  it("still holds when a crewmate worked earlier and left without tapping", () => {
    // They have a closed time entry but no completed_at — treat them as
    // outstanding rather than assuming they are done.
    expect(
      crewStillWorking({
        assignees: [row("a"), row("b")],
        workedIds: ["a", "b"],
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
